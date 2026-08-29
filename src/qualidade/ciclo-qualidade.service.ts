import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { UnidadeTrabalho } from '../database/unidade-trabalho.service.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { UsuarioService } from '../identidade/usuario.service.js';
import {
  OrigemRegistro,
  PapelUsuario,
  ResultadoVerificacao,
  StatusNc,
  StatusTriagem,
} from '../shared/enums/dominio.enums.js';
import { ConflitoError } from '../shared/erros/conflito.error.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';

import { AcaoCorretiva } from './acao-corretiva.entity.js';
import { NaoConformidade } from './nao-conformidade.entity.js';
import { Verificacao } from './verificacao.entity.js';
import {
  ehTerminal,
  exigirTransicaoValida,
  fechamentoPara,
} from './dominio/nc-status.maquina.js';
import { prazoDaAcaoEhValido } from './dominio/politica-prazo.js';
import {
  exigirCoerenciaDeOrigem,
  exigirDeteccaoConfirmada,
} from './dominio/regra-origem.js';
import { exigirSegregacaoDeFuncao } from './dominio/segregacao-funcao.policy.js';
import type { AbrirNcDeDeteccaoDto, AbrirNcManualDto } from './dto/abrir-nc.dto.js';
import type { CancelarNcDto } from './dto/cancelar-nc.dto.js';
import type { ConcluirAcaoDto } from './dto/concluir-acao.dto.js';
import type { CriarAcaoCorretivaDto } from './dto/criar-acao-corretiva.dto.js';
import type { RegistrarVerificacaoDto } from './dto/registrar-verificacao.dto.js';

/**
 * Orquestrador do ciclo da qualidade. Toda transicao de estado passa por
 * aqui, dentro de UMA transacao, com a linha da NC travada.
 *
 * A divisao de responsabilidade e deliberada:
 *   - dominio/      decide SE a regra permite (funcoes puras, sem I/O)
 *   - este servico  coordena a transacao e os efeitos colaterais
 *   - o banco       e a rede de seguranca (CHECK e trigger)
 *
 * As tres camadas dizem a mesma coisa de proposito: o dominio da a mensagem
 * util, o banco garante que nem um INSERT direto burla.
 */
@Injectable()
export class CicloQualidadeService {
  constructor(
    private readonly uow: UnidadeTrabalho,
    private readonly usuarios: UsuarioService,
  ) {}

  // ------------------------------------------------------------- abertura

  /** NC de vistoria de campo, sem camera. */
  async abrirManual(dto: AbrirNcManualDto, ator: UsuarioAutenticado): Promise<NaoConformidade> {
    exigirCoerenciaDeOrigem(OrigemRegistro.MANUAL, null);

    if (dto.responsavelId) await this.usuarios.exigirEngenheiroAtivo(dto.responsavelId);

    return this.uow.executar(ator.id, async (m) => {
      if (dto.reincidenciaDeId) {
        await this.validarReincidencia(m, dto.reincidenciaDeId, dto.obraId);
      }

      const nc = m.create(NaoConformidade, {
        obraId: dto.obraId,
        localId: dto.localId ?? null,
        deteccaoId: null,
        requisitoNormaId: dto.requisitoNormaId ?? null,
        responsavelId: dto.responsavelId ?? null,
        reincidenciaDeId: dto.reincidenciaDeId ?? null,
        origem: OrigemRegistro.MANUAL,
        titulo: dto.titulo,
        descricao: dto.descricao ?? null,
        severidade: dto.severidade,
        status: StatusNc.ABERTA,
        // codigo e prazo sao preenchidos por trigger: o codigo por SEQUENCE
        // (sem colisao sob concorrencia) e o prazo pela severidade.
        codigo: undefined as unknown as string,
      });

      const salva = await m.save(nc);
      return this.recarregar(m, salva.id);
    });
  }

  /**
   * Promove uma deteccao a nao conformidade. Confirma a triagem e cria a NC
   * na MESMA transacao — a ordem importa, porque o trigger
   * fn_nc_deteccao_coerente le o status ja atualizado.
   */
  async abrirDeDeteccao(
    deteccaoId: string,
    dto: AbrirNcDeDeteccaoDto,
    ator: UsuarioAutenticado,
  ): Promise<NaoConformidade> {
    if (dto.responsavelId) await this.usuarios.exigirEngenheiroAtivo(dto.responsavelId);

    return this.uow.executar(ator.id, async (m) => {
      const deteccao = await m.findOne(Deteccao, { where: { id: deteccaoId } });
      if (!deteccao) throw new RecursoNaoEncontradoError('Deteccao', deteccaoId);

      const jaExiste = await m.findOne(NaoConformidade, { where: { deteccaoId } });
      if (jaExiste) {
        throw new ConflitoError(
          'DETECCAO_JA_TEM_NC',
          `Esta deteccao ja gerou a nao conformidade ${jaExiste.codigo}.`,
          { naoConformidadeId: jaExiste.id, codigo: jaExiste.codigo },
        );
      }

      // Triagem ainda pendente: confirmar faz parte de abrir a NC. Quem
      // descarta usa a rota de triagem, que so oferece FALSO_POSITIVO e
      // DUPLICADA — CONFIRMADA so acontece aqui, junto com a NC.
      if (deteccao.statusTriagem === StatusTriagem.PENDENTE) {
        deteccao.statusTriagem = StatusTriagem.CONFIRMADA;
        deteccao.triadoPor = ator.id;
        deteccao.triadoEm = new Date();
        await m.save(deteccao);
      } else {
        exigirDeteccaoConfirmada(deteccao.statusTriagem);
      }

      if (dto.reincidenciaDeId) {
        await this.validarReincidencia(m, dto.reincidenciaDeId, deteccao.obraId);
      }

      const nc = m.create(NaoConformidade, {
        // A obra vem da DETECCAO, nunca do cliente: aceitar do corpo abriria
        // espaco para gravar a NC na obra errada.
        obraId: deteccao.obraId,
        localId: dto.localId ?? null,
        deteccaoId: deteccao.id,
        requisitoNormaId: dto.requisitoNormaId ?? null,
        responsavelId: dto.responsavelId ?? null,
        reincidenciaDeId: dto.reincidenciaDeId ?? null,
        origem: OrigemRegistro.IA,
        titulo: dto.titulo,
        descricao: dto.descricao ?? null,
        severidade: dto.severidade,
        status: StatusNc.ABERTA,
        codigo: undefined as unknown as string,
      });

      const salva = await m.save(nc);
      return this.recarregar(m, salva.id);
    });
  }

  // ------------------------------------------------------------ atribuicao

  async atribuirResponsavel(
    ncId: string,
    responsavelId: string,
    ator: UsuarioAutenticado,
  ): Promise<NaoConformidade> {
    await this.usuarios.exigirEngenheiroAtivo(responsavelId);

    return this.uow.executar(ator.id, async (m) => {
      const nc = await this.travarNc(m, ncId);
      this.exigirNaoTerminal(nc, 'atribuir responsavel');

      nc.responsavelId = responsavelId;
      return m.save(nc);
    });
  }

  // ---------------------------------------------------------- cancelamento

  /**
   * Cancelar e terminal e nao se reverte. Exige justificativa porque e a
   * rota mais facil para maquiar indicador — e por isso tambem so GESTOR
   * pode (imposto no controller).
   */
  async cancelar(
    ncId: string,
    dto: CancelarNcDto,
    ator: UsuarioAutenticado,
  ): Promise<NaoConformidade> {
    return this.uow.executar(
      ator.id,
      async (m) => {
        const nc = await this.travarNc(m, ncId);
        exigirTransicaoValida(nc.status, StatusNc.CANCELADA);

        const agora = new Date();
        nc.status = StatusNc.CANCELADA;
        nc.fechadaEm = fechamentoPara(StatusNc.CANCELADA, agora);

        // Encerra a acao em aberto: sem isto o indice parcial deixa um
        // registro pendurado como "em aberto" para sempre, e o relatorio de
        // acoes pendentes passa a mentir.
        await m
          .createQueryBuilder()
          .update(AcaoCorretiva)
          .set({ concluidaEm: agora })
          .where('nao_conformidade_id = :ncId AND concluida_em IS NULL', { ncId })
          .execute();

        // NC de origem IA cancelada significa que a deteccao nao era um
        // problema real. Sem sincronizar, o indicador de precisao do modelo
        // continua contando aquela deteccao como acerto.
        if (nc.deteccaoId) {
          await m
            .createQueryBuilder()
            .update(Deteccao)
            .set({
              statusTriagem: StatusTriagem.FALSO_POSITIVO,
              triadoPor: ator.id,
              triadoEm: agora,
            })
            .where('id = :id', { id: nc.deteccaoId })
            .execute();
        }

        return m.save(nc);
      },
      dto.motivo,
    );
  }

  // ------------------------------------------------------- acao corretiva

  /** ABERTA -> EM_CORRECAO. A acao nasce com dono; sem dono nao ha o que verificar. */
  async criarAcaoCorretiva(
    ncId: string,
    dto: CriarAcaoCorretivaDto,
    ator: UsuarioAutenticado,
  ): Promise<AcaoCorretiva> {
    await this.usuarios.exigirEngenheiroAtivo(dto.executorId);

    return this.uow.executar(ator.id, async (m) => {
      const nc = await this.travarNc(m, ncId);
      this.exigirResponsavelOuGestor(nc, ator, 'criar acao corretiva');
      exigirTransicaoValida(nc.status, StatusNc.EM_CORRECAO);

      const prazoAcao = dto.prazo ? new Date(dto.prazo) : null;
      if (!prazoDaAcaoEhValido(prazoAcao, nc.prazo)) {
        throw new RegraNegocioError(
          'PRAZO_ACAO_ULTRAPASSA_SLA',
          `O prazo da acao nao pode ultrapassar o prazo da NC (${nc.prazo?.toISOString().slice(0, 10)}), ` +
            `que vem da severidade ${nc.severidade}.`,
        );
      }

      const acao = m.create(AcaoCorretiva, {
        naoConformidadeId: nc.id,
        executorId: dto.executorId,
        descricao: dto.descricao,
        causaRaiz: dto.causaRaiz ?? null,
        prazo: dto.prazo ?? null,
        custo: dto.custo ?? null,
      });
      const salva = await m.save(acao);

      nc.status = StatusNc.EM_CORRECAO;
      await m.save(nc);

      return salva;
    });
  }

  /** EM_CORRECAO -> AGUARDANDO_VERIFICACAO. So o executor conclui. */
  async concluirAcao(
    acaoId: string,
    dto: ConcluirAcaoDto,
    ator: UsuarioAutenticado,
  ): Promise<AcaoCorretiva> {
    return this.uow.executar(ator.id, async (m) => {
      const acao = await m.findOne(AcaoCorretiva, { where: { id: acaoId } });
      if (!acao) throw new RecursoNaoEncontradoError('Acao corretiva', acaoId);

      if (acao.estaConcluida()) {
        throw new ConflitoError('ACAO_JA_CONCLUIDA', 'Esta acao corretiva ja foi concluida.');
      }

      if (acao.executorId !== ator.id && ator.papel !== PapelUsuario.GESTOR) {
        throw new RegraNegocioError(
          'SO_O_EXECUTOR_CONCLUI',
          'Somente quem executou a acao corretiva pode declara-la concluida.',
        );
      }

      const nc = await this.travarNc(m, acao.naoConformidadeId);
      exigirTransicaoValida(nc.status, StatusNc.AGUARDANDO_VERIFICACAO);

      acao.concluidaEm = new Date();
      if (dto.causaRaiz !== undefined) acao.causaRaiz = dto.causaRaiz;
      if (dto.custo !== undefined) acao.custo = dto.custo;
      const salva = await m.save(acao);

      nc.status = StatusNc.AGUARDANDO_VERIFICACAO;
      // fechada_em continua NULL: a NC ainda nao fechou. Carimbar aqui e o
      // erro que estraga o indicador de tempo de ciclo.
      await m.save(nc);

      return salva;
    });
  }

  // --------------------------------------------------------- verificacao

  /**
   * O momento que define o desafio.
   *
   * APROVADA  -> NC RESOLVIDA, com fechada_em = verificado_em
   * REPROVADA -> NC volta para EM_CORRECAO, prazo NAO reaberto
   */
  async registrarVerificacao(
    acaoId: string,
    dto: RegistrarVerificacaoDto,
    ator: UsuarioAutenticado,
  ): Promise<Verificacao> {
    if (dto.resultado === ResultadoVerificacao.REPROVADA && !dto.parecer) {
      throw new RegraNegocioError(
        'PARECER_OBRIGATORIO_NA_REPROVACAO',
        'Reprovar exige parecer: o executor precisa saber o que falta para aprovar.',
      );
    }

    await this.usuarios.exigirEngenheiroAtivo(ator.id);

    return this.uow.executar(ator.id, async (m) => {
      const acao = await m.findOne(AcaoCorretiva, { where: { id: acaoId } });
      if (!acao) throw new RecursoNaoEncontradoError('Acao corretiva', acaoId);

      // Segregacao de funcao. Ha um trigger equivalente no banco; aqui a
      // checagem existe pela mensagem — um 23514 cru nao explica nada.
      exigirSegregacaoDeFuncao(acao.executorId, ator.id);

      if (!acao.estaConcluida()) {
        throw new RegraNegocioError(
          'ACAO_NAO_CONCLUIDA',
          'So se verifica acao corretiva ja concluida pelo executor.',
        );
      }

      const nc = await this.travarNc(m, acao.naoConformidadeId);

      const aprovada = dto.resultado === ResultadoVerificacao.APROVADA;
      const destino = aprovada ? StatusNc.RESOLVIDA : StatusNc.EM_CORRECAO;
      exigirTransicaoValida(nc.status, destino);

      if (aprovada && !nc.requisitoNormaId) {
        // Sem classificacao a NC some do painel de conformidade — que e o
        // produto final. Melhor pedir antes de aprovar do que descobrir na
        // auditoria.
        throw new RegraNegocioError(
          'NC_SEM_REQUISITO_DE_NORMA',
          'Classifique a NC em um requisito da norma antes de aprovar a verificacao. ' +
            'Sem isso ela nao entra no painel de conformidade.',
        );
      }

      const verificacao = m.create(Verificacao, {
        acaoCorretivaId: acao.id,
        verificadoPor: ator.id,
        resultado: dto.resultado,
        parecer: dto.parecer ?? null,
      });
      const salva = await m.save(verificacao);

      nc.status = destino;
      // fechada_em = verificado_em, e nao now(): os dois numeros precisam
      // bater no relatorio.
      nc.fechadaEm = fechamentoPara(destino, salva.verificadoEm);
      // O prazo NAO e estendido na reprovacao: o SLA segue contado desde a
      // abertura. A obra nao ganha tempo por ter feito a correcao errada.
      await m.save(nc);

      return salva;
    });
  }

  // ------------------------------------------------------------- auxiliares

  /**
   * Recarrega a NC depois do INSERT.
   *
   * `codigo` e `prazo` sao preenchidos por TRIGGER (BEFORE INSERT), e o
   * save() do TypeORM devolve a entidade que recebeu — nao a linha como
   * ficou no banco. Sem esta recarga a API responde com codigo `undefined`
   * numa NC que ja existe com codigo no banco, e o front nao tem o que
   * mostrar depois de criar.
   */
  private async recarregar(m: EntityManager, id: string): Promise<NaoConformidade> {
    const nc = await m.findOne(NaoConformidade, { where: { id } });
    if (!nc) throw new RecursoNaoEncontradoError('Nao conformidade', id);
    return nc;
  }

  private async travarNc(m: EntityManager, id: string): Promise<NaoConformidade> {
    const nc = await m
      .createQueryBuilder(NaoConformidade, 'nc')
      .setLock('pessimistic_write')
      .where('nc.id = :id', { id })
      .getOne();

    if (!nc) throw new RecursoNaoEncontradoError('Nao conformidade', id);
    return nc;
  }

  private exigirNaoTerminal(nc: NaoConformidade, acao: string): void {
    if (ehTerminal(nc.status)) {
      throw new ConflitoError(
        'NC_EM_ESTADO_TERMINAL',
        `Nao e possivel ${acao}: a nao conformidade ${nc.codigo} esta ${nc.status}.`,
      );
    }
  }

  private exigirResponsavelOuGestor(
    nc: NaoConformidade,
    ator: UsuarioAutenticado,
    acao: string,
  ): void {
    if (ator.papel === PapelUsuario.GESTOR) return;
    if (nc.responsavelId === ator.id) return;

    throw new RegraNegocioError(
      'NAO_E_RESPONSAVEL',
      `Somente o responsavel pela NC ${nc.codigo} ou um gestor pode ${acao}.`,
    );
  }

  /** Reincidencia aponta para NC da MESMA obra; senao o indicador nao faz sentido. */
  private async validarReincidencia(
    m: EntityManager,
    reincidenciaDeId: string,
    obraId: string,
  ): Promise<void> {
    const anterior = await m.findOne(NaoConformidade, { where: { id: reincidenciaDeId } });
    if (!anterior) throw new RecursoNaoEncontradoError('Nao conformidade', reincidenciaDeId);

    if (anterior.obraId !== obraId) {
      throw new RegraNegocioError(
        'REINCIDENCIA_DE_OUTRA_OBRA',
        'A NC apontada como origem da reincidencia pertence a outra obra.',
      );
    }
  }
}
