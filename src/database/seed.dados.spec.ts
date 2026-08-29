import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { criarBancoComMigrations, type BancoEmMemoria } from './pglite-runner.js';
import { semear } from './seed.dados.js';

/**
 * O seed roda contra o schema real, com todos os CHECK e triggers ativos.
 * Se ele passar aqui, passa no Neon — e se alguma invariante for violada por
 * um dado de demonstracao, quebra em `npm test`, nao na apresentacao.
 */
describe('Seed de demonstracao', () => {
  let db: BancoEmMemoria;
  let resultado: Awaited<ReturnType<typeof semear>>;

  beforeAll(async () => {
    db = await criarBancoComMigrations();
    resultado = await semear((sql, params) => db.query(sql, params));
  }, 90_000);

  afterAll(async () => {
    await db?.fechar();
  });

  it('cria a obra com os dois engenheiros que a segregacao de funcao exige', async () => {
    const engenheiros = await db.query(
      `SELECT id FROM usuario WHERE papel='ENGENHEIRO' AND ativo`,
    );
    expect(engenheiros.length).toBeGreaterThanOrEqual(2);
  });

  it('semeia deteccoes em todos os estados de triagem, com fila pendente', async () => {
    const porStatus = await db.query<{ status_triagem: string; n: string }>(
      `SELECT status_triagem, count(*) n FROM deteccao GROUP BY status_triagem`,
    );
    const mapa = Object.fromEntries(porStatus.map((l) => [l.status_triagem, Number(l.n)]));

    expect(mapa.PENDENTE).toBeGreaterThan(0);
    expect(mapa.CONFIRMADA).toBeGreaterThan(0);
    expect(mapa.FALSO_POSITIVO).toBeGreaterThan(0);
    expect(resultado.totais.deteccoes).toBe(30);
  });

  it('cobre as quatro severidades e os cinco status de NC', async () => {
    const sev = await db.query<{ severidade: string }>(
      `SELECT DISTINCT severidade FROM nao_conformidade`,
    );
    const st = await db.query<{ status: string }>(`SELECT DISTINCT status FROM nao_conformidade`);

    expect(sev.map((s) => s.severidade).sort()).toEqual(['ALTA', 'BAIXA', 'CRITICA', 'MEDIA']);
    expect(st.map((s) => s.status).sort()).toEqual([
      'ABERTA',
      'AGUARDANDO_VERIFICACAO',
      'CANCELADA',
      'EM_CORRECAO',
      'RESOLVIDA',
    ]);
  });

  it('cobre as sete categorias de desempenho, para o painel nao ter buraco', async () => {
    const cats = await db.query<{ categoria: string }>(
      `SELECT DISTINCT categoria FROM requisito_norma`,
    );
    expect(cats).toHaveLength(7);
  });

  it('planta uma reincidencia — o indicador mais relevante para PBQP-H', async () => {
    const [{ n }] = await db.query<{ n: string }>(
      `SELECT count(*) n FROM nao_conformidade WHERE reincidencia_de_id IS NOT NULL`,
    );
    expect(Number(n)).toBeGreaterThanOrEqual(1);
  });

  it('planta um ciclo completo: acao executada por um e verificada por OUTRO', async () => {
    const [ciclo] = await db.query<{ executor_id: string; verificado_por: string }>(
      `SELECT a.executor_id, v.verificado_por
         FROM verificacao v
         JOIN acao_corretiva a ON a.id = v.acao_corretiva_id
        WHERE v.resultado = 'APROVADA'`,
    );

    expect(ciclo).toBeDefined();
    expect(ciclo.executor_id).not.toBe(ciclo.verificado_por);
  });

  it('planta uma NC com prazo vencido para o card de urgencia', async () => {
    const [{ n }] = await db.query<{ n: string }>(
      `SELECT count(*) n FROM nao_conformidade
        WHERE prazo < now() AND status NOT IN ('RESOLVIDA','CANCELADA')`,
    );
    expect(Number(n)).toBeGreaterThanOrEqual(1);
  });

  it('planta uma camera offline para o painel de saude da frota', async () => {
    const [{ n }] = await db.query<{ n: string }>(
      `SELECT count(*) n FROM camera WHERE status = 'OFFLINE'`,
    );
    expect(Number(n)).toBeGreaterThanOrEqual(1);
  });

  it('planta duas versoes do mesmo modelo, para comparar falso positivo', async () => {
    const versoes = await db.query(
      `SELECT versao FROM modelo_ia WHERE nome='trinca-detector' ORDER BY versao`,
    );
    expect(versoes).toHaveLength(2);
  });
});
