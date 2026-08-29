import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArmazenamentoPort } from '../armazenamento/armazenamento.port.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { UnidadeTrabalho } from '../database/unidade-trabalho.service.js';
import { Obra } from '../obras/obra.entity.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import { TipoRelatorio } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import type { IntegridadeResponse } from '../evidencias/dto/integridade.response.js';
import {
  ordenar,
  renderizarDocumento,
  resumir,
  type LinhaRelatorio,
} from './dominio/documento-relatorio.js';
import type { FiltroRelatorioQuery } from './dto/filtro-relatorio.query.js';
import type { GerarRelatorioDto } from './dto/gerar-relatorio.dto.js';
import { ItemRelatorioResponse, RelatorioResponse } from './dto/relatorio.response.js';
import { RelatorioItem } from './relatorio-item.entity.js';
import { Relatorio } from './relatorio.entity.js';

/** Forma crua do SELECT que monta as linhas do documento. */
interface LinhaCrua {
  id: string;
  codigo: string;
  titulo: string;
  severidade: string;
  status: string;
  norma: string | null;
  item_norma: string | null;
  local: string | null;
  responsavel: string | null;
  aberta_em: Date;
  prazo: Date | null;
  fechada_em: Date | null;
}

@Injectable()
export class RelatorioService {
  constructor(
    @InjectRepository(Relatorio)
    private readonly repo: Repository<Relatorio>,
    @InjectRepository(RelatorioItem)
    private readonly itens: Repository<RelatorioItem>,
    @InjectRepository(NaoConformidade)
    private readonly ncs: Repository<NaoConformidade>,
    @InjectRepository(Obra)
    private readonly obras: Repository<Obra>,
    private readonly armazenamento: ArmazenamentoPort,
    private readonly unidade: UnidadeTrabalho,
  ) {}

  /**
   * Gera o documento e o congela.
   *
   * Ordem deliberada: monta o conteudo -> hasheia -> grava no storage ->
   * SO ENTAO abre a transacao que insere `relatorio` + `relatorio_item`.
   *
   * O arquivo e enderecado por conteudo (`relatorios/{aa}/{bb}/{sha}.html`),
   * entao se a transacao falhar depois do upload o que sobra e um objeto
   * orfao e reaproveitavel — nunca uma linha no banco apontando para um
   * arquivo que nao existe, que e o modo de falha que quebraria a
   * verificacao de integridade.
   */
  async gerar(dto: GerarRelatorioDto, autor: UsuarioAutenticado): Promise<RelatorioResponse> {
    const obra = await this.obras.findOne({ where: { id: dto.obraId } });
    if (!obra) throw new RecursoNaoEncontradoError('Obra', dto.obraId);

    if (dto.periodoInicio && dto.periodoFim && dto.periodoFim < dto.periodoInicio) {
      throw new RegraNegocioError(
        'PERIODO_INVERTIDO',
        'periodoFim precisa ser igual ou posterior a periodoInicio.',
      );
    }

    const { linhas: carregadas, idPorCodigo } = await this.carregarLinhas(dto);
    const linhas = ordenar(carregadas);
    if (linhas.length === 0 && dto.tipo === TipoRelatorio.NAO_CONFORMIDADE) {
      throw new RegraNegocioError(
        'RELATORIO_SEM_ITENS',
        'Nenhuma nao conformidade atende aos filtros — um relatorio de NC vazio nao tem o que atestar.',
      );
    }

    // `geradoEm` e calculado UMA vez e usado no documento E na linha do
    // banco: se cada um chamasse `new Date()`, a data impressa no arquivo
    // divergiria da data gravada, e o relatorio se contradiria.
    const geradoEm = new Date();
    const titulo = dto.titulo?.trim() || this.tituloPadrao(dto, obra.codigo, geradoEm);

    const documento = renderizarDocumento(
      {
        titulo,
        tipo: dto.tipo,
        obraCodigo: obra.codigo,
        obraNome: obra.nome,
        periodoInicio: dto.periodoInicio ?? null,
        periodoFim: dto.periodoFim ?? null,
        geradoPor: autor.nome,
        geradoEm,
      },
      linhas,
      resumir(linhas, geradoEm),
    );

    const bytes = Buffer.from(documento, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const chave = `relatorios/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.html`;

    const pastaTmp = await mkdtemp(join(tmpdir(), 'perceptra-relatorio-'));
    try {
      const caminho = join(pastaTmp, 'relatorio.html');
      await writeFile(caminho, bytes);
      await this.armazenamento.salvar(chave, caminho, 'text/html; charset=utf-8');
    } finally {
      await rm(pastaTmp, { recursive: true, force: true }).catch(() => {
        /* pasta temporaria; falhar ao limpar nao deve derrubar a geracao */
      });
    }

    const salvo = await this.unidade.executar(
      autor.id,
      async (manager) => {
        const relatorio = await manager.save(
          manager.create(Relatorio, {
            obraId: dto.obraId,
            geradoPor: autor.id,
            tipo: dto.tipo,
            titulo,
            periodoInicio: dto.periodoInicio ?? null,
            periodoFim: dto.periodoFim ?? null,
            arquivoUri: chave,
            hashSha256: hash,
            geradoEm,
          }),
        );

        if (linhas.length > 0) {
          await manager.insert(
            RelatorioItem,
            linhas.map((linha, indice) => ({
              relatorioId: relatorio.id,
              naoConformidadeId: idPorCodigo.get(linha.codigo)!,
              // `ordem` comeca em 1: o CHECK ck_relatorio_item_ordem exige > 0.
              ordem: indice + 1,
            })),
          );
        }

        return relatorio;
      },
      `Geracao de relatorio ${dto.tipo}`,
    );

    return RelatorioResponse.de(
      salvo,
      linhas.length,
      await this.armazenamento.gerarUrlTemporaria(chave),
    );
  }

  async listar(filtro: FiltroRelatorioQuery): Promise<PaginaDto<RelatorioResponse>> {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.geradoEm', 'DESC');
    if (filtro.obraId) qb.andWhere('r.obraId = :o', { o: filtro.obraId });
    if (filtro.tipo) qb.andWhere('r.tipo = :t', { t: filtro.tipo });

    const [linhas, total] = await qb.skip(filtro.pular).take(filtro.tamanho).getManyAndCount();

    // Uma contagem so para a pagina inteira, em vez de N COUNT(*) num laco.
    const totais = await this.contarItens(linhas.map((r) => r.id));

    return PaginaDto.de(
      linhas.map((r) => RelatorioResponse.de(r, totais.get(r.id) ?? 0, null)),
      total,
      filtro.pagina,
      filtro.tamanho,
    );
  }

  async buscarPorId(id: string): Promise<RelatorioResponse> {
    const relatorio = await this.exigir(id);

    const itens = await this.itens
      .createQueryBuilder('i')
      .innerJoin(NaoConformidade, 'nc', 'nc.id = i.naoConformidadeId')
      .select([
        'i.ordem AS ordem',
        'i.nao_conformidade_id AS "naoConformidadeId"',
        'nc.codigo AS codigo',
        'nc.titulo AS titulo',
        'nc.severidade AS severidade',
        'nc.status AS status',
      ])
      .where('i.relatorioId = :id', { id })
      .orderBy('i.ordem', 'ASC')
      .getRawMany<ItemRelatorioResponse>();

    return RelatorioResponse.de(
      relatorio,
      itens.length,
      relatorio.arquivoUri ? await this.armazenamento.gerarUrlTemporaria(relatorio.arquivoUri) : null,
      itens,
    );
  }

  /** Download direto — funciona com qualquer driver, ao contrario da URL assinada (so S3). */
  async abrirArquivo(id: string): Promise<{ stream: Readable; mime: string; nome: string }> {
    const relatorio = await this.exigir(id);
    if (!relatorio.arquivoUri) {
      throw new RegraNegocioError('RELATORIO_SEM_ARQUIVO', 'Este relatorio nao tem arquivo associado.');
    }

    return {
      stream: await this.armazenamento.abrirLeitura(relatorio.arquivoUri),
      mime: 'text/html; charset=utf-8',
      nome: `${relatorio.titulo.replace(/[^\w.-]+/g, '-')}.html`,
    };
  }

  /** Mesma prova de custodia da evidencia: baixa de novo e recalcula, sem confiar no banco. */
  async verificarIntegridade(id: string): Promise<IntegridadeResponse> {
    const relatorio = await this.exigir(id);
    if (!relatorio.arquivoUri || !relatorio.hashSha256) {
      throw new RegraNegocioError(
        'RELATORIO_SEM_ARQUIVO',
        'Este relatorio nao tem arquivo nem hash para conferir.',
      );
    }

    const hash = createHash('sha256');
    await pipeline(await this.armazenamento.abrirLeitura(relatorio.arquivoUri), hash);
    const hashRecalculado = hash.digest('hex');

    return {
      integra: hashRecalculado === relatorio.hashSha256,
      hashArmazenado: relatorio.hashSha256,
      hashRecalculado,
    };
  }

  /**
   * Devolve as linhas E o mapa codigo -> id.
   *
   * O mapa sai por retorno, e NAO num campo da classe: o service e singleton
   * no Nest, entao um campo mutavel seria compartilhado entre requisicoes —
   * duas geracoes simultaneas se sobrescreveriam e o relatorio de uma obra
   * acabaria com os ids da outra. O documento so conhece o codigo (e o que
   * um humano le); a tabela de itens precisa do id.
   */
  private async carregarLinhas(
    dto: GerarRelatorioDto,
  ): Promise<{ linhas: LinhaRelatorio[]; idPorCodigo: Map<string, string> }> {
    // QueryBuilder com joins crus: RelatoriosModule nao importa
    // QualidadeModule/ObrasModule/NormasModule — leitura nao depende dos
    // modulos de escrita (regra 4). Registra as entidades no proprio
    // forFeature e le direto.
    const qb = this.ncs
      .createQueryBuilder('nc')
      .leftJoin('requisito_norma', 'rn', 'rn.id = nc.requisito_norma_id')
      .leftJoin('local', 'l', 'l.id = nc.local_id')
      .leftJoin('usuario', 'u', 'u.id = nc.responsavel_id')
      .select([
        'nc.id AS id',
        'nc.codigo AS codigo',
        'nc.titulo AS titulo',
        'nc.severidade AS severidade',
        'nc.status AS status',
        'rn.norma AS norma',
        'rn.item AS item_norma',
        'l.nome AS local',
        'u.nome AS responsavel',
        'nc.aberta_em AS aberta_em',
        'nc.prazo AS prazo',
        'nc.fechada_em AS fechada_em',
      ])
      .where('nc.obra_id = :obraId', { obraId: dto.obraId });

    // O recorte de periodo e sobre a ABERTURA da NC, nao sobre o fechamento:
    // um relatorio mensal precisa listar o que apareceu no mes, inclusive o
    // que continua aberto. `periodoFim` entra com o dia inteiro (< fim + 1
    // dia), senao uma NC aberta as 14h do ultimo dia fica de fora.
    if (dto.periodoInicio && dto.periodoFim) {
      qb.andWhere('nc.aberta_em >= :inicio::date', { inicio: dto.periodoInicio });
      qb.andWhere('nc.aberta_em < (:fim::date + INTERVAL \'1 day\')', { fim: dto.periodoFim });
    }

    if (dto.severidades?.length) qb.andWhere('nc.severidade IN (:...sev)', { sev: dto.severidades });
    if (dto.statuses?.length) qb.andWhere('nc.status IN (:...st)', { st: dto.statuses });

    const cruas = await qb.getRawMany<LinhaCrua>();

    const linhas = cruas.map((c) => ({
      codigo: c.codigo,
      titulo: c.titulo,
      severidade: c.severidade as LinhaRelatorio['severidade'],
      status: c.status as LinhaRelatorio['status'],
      norma: c.norma,
      itemNorma: c.item_norma,
      local: c.local,
      responsavel: c.responsavel,
      abertaEm: new Date(c.aberta_em),
      prazo: c.prazo ? new Date(c.prazo) : null,
      fechadaEm: c.fechada_em ? new Date(c.fechada_em) : null,
    }));

    return { linhas, idPorCodigo: new Map(cruas.map((c) => [c.codigo, c.id])) };
  }

  private async contarItens(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();

    const linhas = await this.itens
      .createQueryBuilder('i')
      .select('i.relatorio_id', 'id')
      .addSelect('COUNT(*)::int', 'total')
      .where('i.relatorioId IN (:...ids)', { ids })
      .groupBy('i.relatorio_id')
      .getRawMany<{ id: string; total: number }>();

    return new Map(linhas.map((l) => [l.id, Number(l.total)]));
  }

  private tituloPadrao(dto: GerarRelatorioDto, obraCodigo: string, geradoEm: Date): string {
    const dia = geradoEm.toISOString().slice(0, 10);
    if (dto.tipo === TipoRelatorio.PERIODICO) {
      return `Relatorio periodico ${obraCodigo} — ${dto.periodoInicio} a ${dto.periodoFim}`;
    }
    if (dto.tipo === TipoRelatorio.OBRA) {
      return `Relatorio da obra ${obraCodigo} — ${dia}`;
    }
    return `Relatorio de nao conformidades ${obraCodigo} — ${dia}`;
  }

  private async exigir(id: string): Promise<Relatorio> {
    const relatorio = await this.repo.findOne({ where: { id } });
    if (!relatorio) throw new RecursoNaoEncontradoError('Relatorio', id);
    return relatorio;
  }
}
