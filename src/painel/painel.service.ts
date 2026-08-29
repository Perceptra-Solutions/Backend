import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Camera } from '../catalogo-ia/camera.entity.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { StatusCamera, StatusNc } from '../shared/enums/dominio.enums.js';
import type { FiltroPainelQuery } from './dto/filtro-painel.query.js';
import type {
  FalsoPositivoPorModeloItem,
  NcsPorCategoriaItem,
  NcsPorSeveridadeItem,
  ResumoPainelResponse,
  SaudeFrotaResponse,
} from './dto/resumo-painel.response.js';

const ESTADOS_TERMINAIS: StatusNc[] = [StatusNc.RESOLVIDA, StatusNc.CANCELADA];

/**
 * Repositorio de leitura proprio: painel nao importa QualidadeModule,
 * CatalogoIaModule nem IngestaoModule — so as ENTIDADES via forFeature
 * (regra 4 do ANDAMENTO.md, secao 6: "leitura nao usa os modulos de escrita").
 */
@Injectable()
export class PainelService {
  constructor(
    @InjectRepository(NaoConformidade)
    private readonly ncs: Repository<NaoConformidade>,
    @InjectRepository(Deteccao)
    private readonly deteccoes: Repository<Deteccao>,
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    @InjectRepository(ModeloIa)
    private readonly modelos: Repository<ModeloIa>,
  ) {}

  async resumo(filtro: FiltroPainelQuery): Promise<ResumoPainelResponse> {
    const [
      ncsAbertasPorSeveridade,
      ncsAbertasPorCategoria,
      ncsComPrazoVencido,
      tempoMedioFechamentoHoras,
      taxaReincidencia,
      falsoPositivoPorModelo,
      saudeDaFrota,
    ] = await Promise.all([
      this.ncsAbertasPorSeveridade(filtro.obraId),
      this.ncsAbertasPorCategoria(filtro.obraId),
      this.ncsComPrazoVencido(filtro.obraId),
      this.tempoMedioFechamentoHoras(filtro.obraId),
      this.taxaReincidencia(filtro.obraId),
      this.falsoPositivoPorModelo(filtro.obraId),
      this.saudeDaFrota(filtro.obraId),
    ]);

    return {
      obraId: filtro.obraId ?? null,
      ncsAbertasPorSeveridade,
      ncsAbertasPorCategoria,
      ncsComPrazoVencido,
      tempoMedioFechamentoHoras,
      taxaReincidencia,
      falsoPositivoPorModelo,
      saudeDaFrota,
    };
  }

  /** Usa o indice parcial ix_nc_abertas (obra_id, severidade, prazo) WHERE status NOT IN (...). */
  private async ncsAbertasPorSeveridade(obraId?: string): Promise<NcsPorSeveridadeItem[]> {
    const qb = this.ncs
      .createQueryBuilder('nc')
      .select('nc.severidade', 'severidade')
      .addSelect('COUNT(*)', 'total')
      .where('nc.status NOT IN (:...terminais)', { terminais: ESTADOS_TERMINAIS });

    if (obraId) qb.andWhere('nc.obraId = :obraId', { obraId });

    const linhas = await qb.groupBy('nc.severidade').getRawMany<{ severidade: string; total: string }>();

    return linhas.map((l) => ({ severidade: l.severidade as NcsPorSeveridadeItem['severidade'], total: Number(l.total) }));
  }

  /**
   * LEFT JOIN em requisito_norma (tabela crua, sem relacao TypeORM): NC sem
   * requisito_norma_id cai no bucket NAO_CLASSIFICADA em vez de sumir da
   * contagem — regra explicita do ANDAMENTO.md para nao mascarar a qualidade
   * do processo de classificacao.
   */
  private async ncsAbertasPorCategoria(obraId?: string): Promise<NcsPorCategoriaItem[]> {
    const categoria = `COALESCE(rn.categoria::text, 'NAO_CLASSIFICADA')`;

    const qb = this.ncs
      .createQueryBuilder('nc')
      .leftJoin('requisito_norma', 'rn', 'rn.id = nc.requisitoNormaId')
      .select(categoria, 'categoria')
      .addSelect('COUNT(*)', 'total')
      .where('nc.status NOT IN (:...terminais)', { terminais: ESTADOS_TERMINAIS });

    if (obraId) qb.andWhere('nc.obraId = :obraId', { obraId });

    const linhas = await qb.groupBy(categoria).getRawMany<{ categoria: string; total: string }>();

    return linhas.map((l) => ({ categoria: l.categoria, total: Number(l.total) }));
  }

  private async ncsComPrazoVencido(obraId?: string): Promise<number> {
    const qb = this.ncs
      .createQueryBuilder('nc')
      .where('nc.status NOT IN (:...terminais)', { terminais: ESTADOS_TERMINAIS })
      .andWhere('nc.prazo < :agora', { agora: new Date() });

    if (obraId) qb.andWhere('nc.obraId = :obraId', { obraId });

    return qb.getCount();
  }

  /**
   * So RESOLVIDA entra: CANCELADA tambem tem fechada_em preenchido (CHECK
   * ck_nc_fechamento), mas nao foi "fechada" no sentido de qualidade
   * resolvida — e a mesma regra "status <> CANCELADA" do ANDAMENTO.md.
   */
  private async tempoMedioFechamentoHoras(obraId?: string): Promise<number | null> {
    const qb = this.ncs
      .createQueryBuilder('nc')
      .select('AVG(EXTRACT(EPOCH FROM (nc.fechadaEm - nc.abertaEm)) / 3600)', 'horas')
      .where('nc.status = :resolvida', { resolvida: StatusNc.RESOLVIDA });

    if (obraId) qb.andWhere('nc.obraId = :obraId', { obraId });

    const linha = await qb.getRawOne<{ horas: string | null }>();
    return linha?.horas == null ? null : Number(linha.horas);
  }

  private async taxaReincidencia(obraId?: string): Promise<number> {
    const qb = this.ncs
      .createQueryBuilder('nc')
      .select('COUNT(*) FILTER (WHERE nc.reincidenciaDeId IS NOT NULL)', 'reincidentes')
      .addSelect('COUNT(*)', 'total')
      .where('nc.status <> :cancelada', { cancelada: StatusNc.CANCELADA });

    if (obraId) qb.andWhere('nc.obraId = :obraId', { obraId });

    const linha = await qb.getRawOne<{ reincidentes: string; total: string }>();
    const total = Number(linha?.total ?? 0);
    const reincidentes = Number(linha?.reincidentes ?? 0);

    return total > 0 ? reincidentes / total : 0;
  }

  /**
   * Falso positivo e por modelo/versao, nao por deteccao no geral: um modelo
   * ruim precisa aparecer isolado, senao um modelo bom "dilui" a taxa de um
   * ruim na media geral. Taxa = FALSO_POSITIVO / triadas (exclui PENDENTE,
   * que ainda nao foi julgada).
   */
  private async falsoPositivoPorModelo(obraId?: string): Promise<FalsoPositivoPorModeloItem[]> {
    const qb = this.deteccoes
      .createQueryBuilder('d')
      .select('d.modeloIaId', 'modeloIaId')
      .addSelect(`COUNT(*) FILTER (WHERE d.statusTriagem <> 'PENDENTE')`, 'totalTriado')
      .addSelect(`COUNT(*) FILTER (WHERE d.statusTriagem = 'FALSO_POSITIVO')`, 'falsosPositivos');

    if (obraId) qb.where('d.obraId = :obraId', { obraId });

    const linhas = await qb
      .groupBy('d.modeloIaId')
      .getRawMany<{ modeloIaId: string; totalTriado: string; falsosPositivos: string }>();

    if (linhas.length === 0) return [];

    const modelos = await this.modelos.findBy({ id: In(linhas.map((l) => l.modeloIaId)) });
    const modeloPorId = new Map(modelos.map((m) => [m.id, m]));

    return linhas.map((l) => {
      const modelo = modeloPorId.get(l.modeloIaId);
      const totalTriado = Number(l.totalTriado);
      const falsosPositivos = Number(l.falsosPositivos);

      return {
        modeloId: l.modeloIaId,
        modeloNome: modelo?.nome ?? 'desconhecido',
        modeloVersao: modelo?.versao ?? '',
        totalTriado,
        falsosPositivos,
        taxa: totalTriado > 0 ? falsosPositivos / totalTriado : 0,
      };
    });
  }

  /** Contagem por status. OFFLINE/ATIVA sao mantidos pelo CameraHeartbeatScheduler. */
  private async saudeDaFrota(obraId?: string): Promise<SaudeFrotaResponse> {
    const qb = this.cameras
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'total');

    if (obraId) qb.where('c.obraId = :obraId', { obraId });

    const linhas = await qb.groupBy('c.status').getRawMany<{ status: StatusCamera; total: string }>();

    const porStatus = new Map(linhas.map((l) => [l.status, Number(l.total)]));
    const total = [...porStatus.values()].reduce((soma, n) => soma + n, 0);

    return {
      total,
      ativas: porStatus.get(StatusCamera.ATIVA) ?? 0,
      offline: porStatus.get(StatusCamera.OFFLINE) ?? 0,
      manutencao: porStatus.get(StatusCamera.MANUTENCAO) ?? 0,
    };
  }
}
