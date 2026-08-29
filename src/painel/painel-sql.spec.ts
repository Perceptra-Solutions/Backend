import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoComMigrations, type BancoEmMemoria } from '../database/pglite-runner.js';

/**
 * PainelService fala com o banco via Repository/QueryBuilder do TypeORM, que
 * exige um DataSource real (Postgres/Docker) — o que este ambiente nao tem
 * (mesma limitacao registrada para a Fase 4 no ANDAMENTO.md). Este spec
 * verifica a MESMA agregacao que cada metodo do service monta, direto contra
 * as migrations reais via PGlite, para pegar erro de sintaxe/cast/agrupamento
 * antes de subir o container. Nao substitui o e2e contra Postgres real.
 */
describe('SQL usado por PainelService (contra o schema real)', () => {
  let db: BancoEmMemoria;
  let engenheiro: string;
  let obra: string;
  let outraObra: string;
  let requisitoEstrutural: string;

  async function um<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    return (await db.query<T>(sql, params))[0];
  }

  beforeAll(async () => {
    db = await criarBancoComMigrations();
  }, 60_000);

  afterAll(async () => {
    await db?.fechar();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE deteccao, nao_conformidade, camera, modelo_ia, requisito_norma, obra, usuario RESTART IDENTITY CASCADE`,
    );

    engenheiro = (
      await um<{ id: string }>(
        `INSERT INTO usuario (nome,email,senha_hash,papel,crea) VALUES ('Ana','ana@painel.dev','x','ENGENHEIRO','MG-1') RETURNING id`,
      )
    ).id;
    obra = (await um<{ id: string }>(`INSERT INTO obra (codigo,nome) VALUES ('OB-PAINEL','Obra painel') RETURNING id`))
      .id;
    outraObra = (
      await um<{ id: string }>(`INSERT INTO obra (codigo,nome) VALUES ('OB-OUTRA','Outra obra') RETURNING id`)
    ).id;
    requisitoEstrutural = (
      await um<{ id: string }>(
        `INSERT INTO requisito_norma (norma,item,categoria,descricao)
         VALUES ('NBR 15575','Parte 2 - 8','ESTRUTURAL','Desempenho estrutural') RETURNING id`,
      )
    ).id;
  });

  async function inserirNc(opts: {
    obraId?: string;
    severidade?: string;
    status?: string;
    abertaEm?: string;
    fechadaEm?: string | null;
    requisitoNormaId?: string | null;
    reincidenciaDeId?: string | null;
  }): Promise<string> {
    const linha = await um<{ id: string }>(
      `INSERT INTO nao_conformidade
         (obra_id, origem, titulo, severidade, status, aberta_em, fechada_em, requisito_norma_id, reincidencia_de_id)
       VALUES ($1,'MANUAL','NC de teste',$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        opts.obraId ?? obra,
        opts.severidade ?? 'MEDIA',
        opts.status ?? 'ABERTA',
        opts.abertaEm ?? new Date().toISOString(),
        opts.fechadaEm ?? null,
        opts.requisitoNormaId ?? null,
        opts.reincidenciaDeId ?? null,
      ],
    );
    return linha.id;
  }

  describe('ncsAbertasPorSeveridade', () => {
    const SQL = `
      SELECT severidade, COUNT(*) as total
      FROM nao_conformidade
      WHERE status NOT IN ('RESOLVIDA','CANCELADA') AND obra_id = $1
      GROUP BY severidade`;

    it('conta por severidade, ignora RESOLVIDA/CANCELADA e outras obras', async () => {
      await inserirNc({ severidade: 'CRITICA', status: 'ABERTA' });
      await inserirNc({ severidade: 'CRITICA', status: 'EM_CORRECAO' });
      await inserirNc({ severidade: 'ALTA', status: 'AGUARDANDO_VERIFICACAO' });
      await inserirNc({ severidade: 'CRITICA', status: 'RESOLVIDA', fechadaEm: new Date().toISOString() });
      await inserirNc({ severidade: 'CRITICA', status: 'CANCELADA', fechadaEm: new Date().toISOString() });
      await inserirNc({ obraId: outraObra, severidade: 'CRITICA', status: 'ABERTA' });

      const linhas = await db.query<{ severidade: string; total: string }>(SQL, [obra]);
      const porSeveridade = Object.fromEntries(linhas.map((l) => [l.severidade, Number(l.total)]));

      expect(porSeveridade.CRITICA).toBe(2);
      expect(porSeveridade.ALTA).toBe(1);
      expect(porSeveridade.MEDIA).toBeUndefined();
    });
  });

  describe('ncsAbertasPorCategoria', () => {
    const SQL = `
      SELECT COALESCE(rn.categoria::text, 'NAO_CLASSIFICADA') as categoria, COUNT(*) as total
      FROM nao_conformidade nc
      LEFT JOIN requisito_norma rn ON rn.id = nc.requisito_norma_id
      WHERE nc.status NOT IN ('RESOLVIDA','CANCELADA') AND nc.obra_id = $1
      GROUP BY categoria`;

    it('agrupa por categoria do requisito e usa NAO_CLASSIFICADA quando nao ha requisito', async () => {
      await inserirNc({ requisitoNormaId: requisitoEstrutural });
      await inserirNc({ requisitoNormaId: requisitoEstrutural });
      await inserirNc({ requisitoNormaId: null });

      const linhas = await db.query<{ categoria: string; total: string }>(SQL, [obra]);
      const porCategoria = Object.fromEntries(linhas.map((l) => [l.categoria, Number(l.total)]));

      expect(porCategoria.ESTRUTURAL).toBe(2);
      expect(porCategoria.NAO_CLASSIFICADA).toBe(1);
    });
  });

  describe('ncsComPrazoVencido', () => {
    const SQL = `
      SELECT COUNT(*)::int as total
      FROM nao_conformidade
      WHERE status NOT IN ('RESOLVIDA','CANCELADA') AND prazo < now() AND obra_id = $1`;

    it('conta so as nao terminais cujo prazo ja passou', async () => {
      // BAIXA = 15 dias de prazo; aberta ha 20 dias -> prazo ja passou.
      await inserirNc({
        severidade: 'BAIXA',
        status: 'ABERTA',
        abertaEm: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      });
      // CRITICA = 24h de prazo; aberta agora -> ainda dentro do prazo.
      await inserirNc({ severidade: 'CRITICA', status: 'ABERTA' });

      const { total } = await um<{ total: number }>(SQL, [obra]);
      expect(total).toBe(1);
    });
  });

  describe('tempoMedioFechamentoHoras', () => {
    const SQL = `
      SELECT AVG(EXTRACT(EPOCH FROM (fechada_em - aberta_em)) / 3600) as horas
      FROM nao_conformidade
      WHERE status = 'RESOLVIDA' AND obra_id = $1`;

    it('calcula a media em horas so sobre RESOLVIDA', async () => {
      const abertaEm = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await inserirNc({
        status: 'RESOLVIDA',
        abertaEm: abertaEm.toISOString(),
        fechadaEm: new Date().toISOString(),
      });
      // CANCELADA tambem tem fechada_em, mas NAO deve entrar na media.
      await inserirNc({
        status: 'CANCELADA',
        abertaEm: abertaEm.toISOString(),
        fechadaEm: new Date().toISOString(),
      });

      const { horas } = await um<{ horas: string }>(SQL, [obra]);
      expect(Number(horas)).toBeCloseTo(48, 0);
    });

    it('retorna null quando nao ha nenhuma RESOLVIDA', async () => {
      await inserirNc({ status: 'ABERTA' });
      const { horas } = await um<{ horas: string | null }>(SQL, [obra]);
      expect(horas).toBeNull();
    });
  });

  describe('taxaReincidencia', () => {
    const SQL = `
      SELECT
        COUNT(*) FILTER (WHERE reincidencia_de_id IS NOT NULL)::int as reincidentes,
        COUNT(*)::int as total
      FROM nao_conformidade
      WHERE status <> 'CANCELADA' AND obra_id = $1`;

    it('exclui CANCELADA do denominador e conta reincidencia_de_id preenchido', async () => {
      const original = await inserirNc({ status: 'RESOLVIDA', fechadaEm: new Date().toISOString() });
      await inserirNc({ status: 'ABERTA', reincidenciaDeId: original });
      await inserirNc({ status: 'ABERTA' });
      await inserirNc({ status: 'CANCELADA', fechadaEm: new Date().toISOString() });

      const { reincidentes, total } = await um<{ reincidentes: number; total: number }>(SQL, [obra]);
      expect(reincidentes).toBe(1);
      expect(total).toBe(3);
    });
  });

  describe('falsoPositivoPorModelo', () => {
    const SQL = `
      SELECT
        d.modelo_ia_id,
        COUNT(*) FILTER (WHERE d.status_triagem <> 'PENDENTE')::int as total_triado,
        COUNT(*) FILTER (WHERE d.status_triagem = 'FALSO_POSITIVO')::int as falsos_positivos
      FROM deteccao d
      WHERE d.obra_id = $1
      GROUP BY d.modelo_ia_id`;

    it('conta falso positivo e total triado por modelo, ignorando PENDENTE no denominador', async () => {
      const modelo = (
        await um<{ id: string }>(
          `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
           VALUES ('trinca-detector','1.0.0','TRINCA',0.700) RETURNING id`,
        )
      ).id;
      const camera = (
        await um<{ id: string }>(
          `INSERT INTO camera (obra_id,identificador,modelo_ia_id) VALUES ($1,'CAM-PAINEL',$2) RETURNING id`,
          [obra, modelo],
        )
      ).id;

      async function inserirDeteccao(statusTriagem: string) {
        const pendente = statusTriagem === 'PENDENTE';
        await db.query(
          `INSERT INTO deteccao (camera_id,modelo_ia_id,classe,confianca,ocorrido_em,status_triagem,triado_por,triado_em)
           VALUES ($1,$2,'TRINCA',0.9,now(),$3,$4,$5)`,
          [camera, modelo, statusTriagem, pendente ? null : engenheiro, pendente ? null : new Date().toISOString()],
        );
      }

      await inserirDeteccao('PENDENTE');
      await inserirDeteccao('CONFIRMADA');
      await inserirDeteccao('CONFIRMADA');
      await inserirDeteccao('FALSO_POSITIVO');

      const { total_triado, falsos_positivos } = await um<{ total_triado: number; falsos_positivos: number }>(
        SQL,
        [obra],
      );
      expect(total_triado).toBe(3);
      expect(falsos_positivos).toBe(1);
    });
  });

  describe('saudeDaFrota', () => {
    const SQL = `SELECT status, COUNT(*)::int as total FROM camera WHERE obra_id = $1 GROUP BY status`;

    it('conta cameras por status', async () => {
      await db.query(`INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-1','ATIVA')`, [obra]);
      await db.query(`INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-2','OFFLINE')`, [obra]);
      await db.query(`INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-3','MANUTENCAO')`, [obra]);
      await db.query(`INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-4','ATIVA')`, [obra]);

      const linhas = await db.query<{ status: string; total: number }>(SQL, [obra]);
      const porStatus = Object.fromEntries(linhas.map((l) => [l.status, l.total]));

      expect(porStatus.ATIVA).toBe(2);
      expect(porStatus.OFFLINE).toBe(1);
      expect(porStatus.MANUTENCAO).toBe(1);
    });
  });
});
