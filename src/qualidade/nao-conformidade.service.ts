import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import { SeveridadeNc, StatusNc } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { AcaoCorretiva } from './acao-corretiva.entity.js';
import { estaAtrasada } from './dominio/nc-status.maquina.js';
import type { AtualizarNcDto } from './dto/atualizar-nc.dto.js';
import { NaoConformidadeEvento } from './nao-conformidade-evento.entity.js';
import { NaoConformidade } from './nao-conformidade.entity.js';
import { Verificacao } from './verificacao.entity.js';

export interface FiltroNc {
  obraId?: string;
  status?: StatusNc;
  severidade?: SeveridadeNc;
  responsavelId?: string;
  requisitoNormaId?: string;
  atrasadas?: boolean;
}

/**
 * Leitura e edicao de texto da NC. As TRANSICOES DE ESTADO nao moram aqui:
 * elas exigem transacao e lock, e vivem no CicloQualidadeService.
 */
@Injectable()
export class NaoConformidadeService {
  constructor(
    @InjectRepository(NaoConformidade)
    private readonly repo: Repository<NaoConformidade>,
    @InjectRepository(AcaoCorretiva)
    private readonly acoes: Repository<AcaoCorretiva>,
    @InjectRepository(Verificacao)
    private readonly verificacoes: Repository<Verificacao>,
    @InjectRepository(NaoConformidadeEvento)
    private readonly eventos: Repository<NaoConformidadeEvento>,
  ) {}

  async listar(paginacao: PaginacaoQuery, filtro: FiltroNc) {
    const qb = this.repo.createQueryBuilder('nc');

    if (filtro.obraId) qb.andWhere('nc.obraId = :obraId', { obraId: filtro.obraId });
    if (filtro.status) qb.andWhere('nc.status = :status', { status: filtro.status });
    if (filtro.severidade) qb.andWhere('nc.severidade = :sev', { sev: filtro.severidade });
    if (filtro.responsavelId) {
      qb.andWhere('nc.responsavelId = :resp', { resp: filtro.responsavelId });
    }
    if (filtro.requisitoNormaId) {
      qb.andWhere('nc.requisitoNormaId = :req', { req: filtro.requisitoNormaId });
    }
    if (filtro.atrasadas) {
      // Casa com o indice parcial ix_nc_abertas.
      qb.andWhere('nc.prazo < now()').andWhere(
        `nc.status NOT IN ('${StatusNc.RESOLVIDA}','${StatusNc.CANCELADA}')`,
      );
    }

    const [itens, total] = await qb
      // Mais urgente primeiro: o gestor abre esta tela para saber o que
      // esta estourando, nao para ver a NC mais recente.
      .orderBy('nc.prazo', 'ASC', 'NULLS LAST')
      .addOrderBy('nc.abertaEm', 'DESC')
      .skip(paginacao.pular)
      .take(paginacao.tamanho)
      .getManyAndCount();

    return PaginaDto.de(
      itens.map((nc) => this.comAtraso(nc)),
      total,
      paginacao.pagina,
      paginacao.tamanho,
    );
  }

  async buscarPorId(id: string) {
    const nc = await this.exigirNc(id);
    const acoes = await this.acoes.find({
      where: { naoConformidadeId: id },
      order: { iniciadaEm: 'ASC' },
    });

    const verificacoes = acoes.length
      ? await this.verificacoes.find({
          where: acoes.map((a) => ({ acaoCorretivaId: a.id })),
          order: { verificadoEm: 'ASC' },
        })
      : [];

    return {
      ...this.comAtraso(nc),
      acoesCorretivas: acoes.map((a) => ({
        ...a,
        concluida: a.estaConcluida(),
        verificacoes: verificacoes.filter((v) => v.acaoCorretivaId === a.id),
      })),
    };
  }

  /**
   * Linha do tempo completa: quem mudou o quê, quando e por quê. Vem da
   * tabela escrita por trigger, entao inclui inclusive alteracao feita fora
   * da API.
   */
  async historico(id: string) {
    await this.exigirNc(id);

    const eventos = await this.eventos.find({
      where: { naoConformidadeId: id },
      order: { ocorridoEm: 'ASC' },
    });

    return eventos.map((e) => ({
      de: e.de,
      para: e.para,
      // ator nulo = alteracao de sistema (seed, migration, script).
      atorId: e.atorId,
      motivo: e.motivo,
      ocorridoEm: e.ocorridoEm,
    }));
  }

  async atualizar(id: string, dto: AtualizarNcDto) {
    const nc = await this.exigirNc(id);

    // Nada de status, codigo, severidade ou prazo: o ValidationPipe com
    // whitelist ja rejeita, e o DTO nao os expoe.
    Object.assign(nc, {
      titulo: dto.titulo ?? nc.titulo,
      descricao: dto.descricao === undefined ? nc.descricao : dto.descricao,
      requisitoNormaId: dto.requisitoNormaId ?? nc.requisitoNormaId,
      localId: dto.localId ?? nc.localId,
    });

    return this.comAtraso(await this.repo.save(nc));
  }

  private async exigirNc(id: string): Promise<NaoConformidade> {
    const nc = await this.repo.findOne({ where: { id } });
    if (!nc) throw new RecursoNaoEncontradoError('Nao conformidade', id);
    return nc;
  }

  /** "atrasada" e derivado do relogio, nunca uma coluna. */
  private comAtraso(nc: NaoConformidade) {
    return { ...nc, atrasada: estaAtrasada(nc.status, nc.prazo) };
  }
}
