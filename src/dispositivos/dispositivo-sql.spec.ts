import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoComMigrations, type BancoEmMemoria } from '../database/pglite-runner.js';

/**
 * DispositivoService fala com o banco via Repository do TypeORM, que exige
 * um DataSource real (Postgres/Docker) — o que este ambiente nao tem. Este
 * spec verifica a mesma SQL que o service manda, direto contra as migrations
 * reais via PGlite, para pegar erro de sintaxe/cast/indice ANTES de subir
 * o container. Nao substitui o e2e contra Postgres real.
 */
describe('SQL usado por DispositivoService (contra o schema real)', () => {
  let db: BancoEmMemoria;
  let camera: string;
  let modelo: string;

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
    await db.query(`TRUNCATE deteccao, credencial_dispositivo, camera, modelo_ia, obra RESTART IDENTITY CASCADE`);

    const obra = await um<{ id: string }>(
      `INSERT INTO obra (codigo,nome) VALUES ('OB-SQL','Obra de teste') RETURNING id`,
    );
    modelo = (
      await um<{ id: string }>(
        `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
         VALUES ('trinca-detector','1.0.0','TRINCA',0.700) RETURNING id`,
      )
    ).id;
    camera = (
      await um<{ id: string }>(
        `INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-SQL','OFFLINE') RETURNING id`,
        [obra.id],
      )
    ).id;
  });

  describe('heartbeat', () => {
    // Exatamente a query de DispositivoService.registrarHeartbeat.
    const SQL_HEARTBEAT = `UPDATE camera
        SET ultimo_heartbeat = now(),
            status = CASE WHEN status = $2::status_camera THEN $3::status_camera ELSE status END
      WHERE id = $1`;

    it('volta OFFLINE -> ATIVA e grava o timestamp', async () => {
      await db.query(SQL_HEARTBEAT, [camera, 'OFFLINE', 'ATIVA']);
      const linha = await um<{ status: string; ultimo_heartbeat: string }>(
        `SELECT status, ultimo_heartbeat FROM camera WHERE id=$1`,
        [camera],
      );
      expect(linha.status).toBe('ATIVA');
      expect(linha.ultimo_heartbeat).toBeTruthy();
    });

    it('nao mexe no status se a camera esta em MANUTENCAO (so acorda quem tava OFFLINE)', async () => {
      await db.query(`UPDATE camera SET status='MANUTENCAO' WHERE id=$1`, [camera]);
      await db.query(SQL_HEARTBEAT, [camera, 'OFFLINE', 'ATIVA']);
      const { status } = await um<{ status: string }>(`SELECT status FROM camera WHERE id=$1`, [camera]);
      expect(status).toBe('MANUTENCAO');
    });
  });

  describe('ingestao — dedup via ON CONFLICT DO NOTHING', () => {
    async function inserirDeteccao(idExterno: string | null) {
      return db.query(
        `INSERT INTO deteccao (camera_id,modelo_ia_id,id_externo,classe,confianca,ocorrido_em)
         VALUES ($1,$2,$3,'TRINCA',0.9,now())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [camera, modelo, idExterno],
      );
    }

    it('a segunda insercao com o mesmo id_externo e silenciosamente ignorada', async () => {
      const primeira = await inserirDeteccao('cam-sql-001');
      const segunda = await inserirDeteccao('cam-sql-001');

      expect(primeira).toHaveLength(1);
      expect(segunda).toHaveLength(0); // sem RETURNING: foi ignorada, nao e erro

      const { count } = await um<{ count: string }>(
        `SELECT count(*)::int as count FROM deteccao WHERE id_externo='cam-sql-001'`,
      );
      expect(Number(count)).toBe(1);
    });

    it('varias deteccoes com id_externo NULL nao conflitam entre si (indice e parcial)', async () => {
      const a = await inserirDeteccao(null);
      const b = await inserirDeteccao(null);

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    it('obra_id vem do trigger a partir da camera, mesmo sem o INSERT informar', async () => {
      const [{ id }] = await inserirDeteccao('cam-sql-obra');
      const det = await um<{ obra_id: string }>(`SELECT obra_id FROM deteccao WHERE id=$1`, [id]);
      const cam = await um<{ obra_id: string }>(`SELECT obra_id FROM camera WHERE id=$1`, [camera]);
      expect(det.obra_id).toBe(cam.obra_id);
    });
  });
});
