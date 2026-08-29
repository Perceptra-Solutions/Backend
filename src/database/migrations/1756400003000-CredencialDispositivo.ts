import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identidade de dispositivo (Fase 4.1): a camera Perceptra One precisa se
 * autenticar perante a API sem ser uma pessoa com login. Ver
 * `src/catalogo-ia/dominio/credencial-dispositivo.util.ts` para o formato
 * da chave e como o hash e calculado/conferido.
 *
 * FK para `camera` com ON DELETE RESTRICT, no mesmo espirito do resto do
 * MER: uma credencial emitida e prova de proveniencia de deteccao — apagar
 * a camera sem lidar com a credencial primeiro apagaria esse rastro.
 */
export class CredencialDispositivo1756400003000 implements MigrationInterface {
  name = 'CredencialDispositivo1756400003000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE credencial_dispositivo (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        camera_id      uuid NOT NULL REFERENCES camera(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        prefixo        text NOT NULL,
        hash_secreto   char(64) NOT NULL,
        escopos        text[] NOT NULL DEFAULT '{}',
        criada_em      timestamptz NOT NULL DEFAULT now(),
        revogada_em    timestamptz,
        ultimo_uso_em  timestamptz,
        CONSTRAINT ck_credencial_hash CHECK (hash_secreto ~ '^[0-9a-f]{64}$')
      )`);

    await q.query(
      `CREATE UNIQUE INDEX ux_credencial_prefixo ON credencial_dispositivo (prefixo)`,
    );
    await q.query(`CREATE INDEX ix_credencial_camera ON credencial_dispositivo (camera_id)`);
    // A guarda de API key busca so entre as vigentes; indice parcial mantem
    // essa consulta (a mais frequente do sistema, uma por ingestao) pequena.
    await q.query(
      `CREATE INDEX ix_credencial_vigente ON credencial_dispositivo (prefixo) WHERE revogada_em IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS credencial_dispositivo CASCADE`);
  }
}
