import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planta / mapa da obra: o arquivo que o usuario sobe para enxergar o
 * canteiro no sistema (`GET /obras/:id/planta`).
 *
 * Colunas na propria `obra`, e nao uma tabela nova, porque a relacao e 1:1 e
 * substitutiva — uma obra tem no maximo uma planta vigente, e subir outra
 * troca a anterior. Uma tabela `planta_obra` so faria sentido se houvesse
 * historico de versoes, que nao e o requisito.
 *
 * Reaproveita o mesmo padrao da evidencia: o binario vive no storage
 * (`ArmazenamentoPort`, S3 ou disco) e o banco guarda so a chave, o hash e o
 * metadado. Diferente da evidencia, a planta NAO e imutavel: e cadastro, nao
 * prova — por isso nao entra na cadeia de custodia nem tem trigger de
 * bloqueio.
 */
export class PlantaDaObra1756400004000 implements MigrationInterface {
  name = 'PlantaDaObra1756400004000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE obra
        ADD COLUMN planta_uri            text,
        ADD COLUMN planta_nome           text,
        ADD COLUMN planta_mime           text,
        ADD COLUMN planta_hash_sha256    char(64),
        ADD COLUMN planta_tamanho_bytes  bigint,
        ADD COLUMN planta_atualizada_em  timestamptz
    `);

    // Mesmo CHECK de formato da evidencia: hash so entra em hex de 64 chars.
    await q.query(`
      ALTER TABLE obra
        ADD CONSTRAINT ck_obra_planta_hash
        CHECK (planta_hash_sha256 IS NULL OR planta_hash_sha256 ~ '^[0-9a-f]{64}$')
    `);

    // Ou a planta esta completa, ou nao existe. Sem isto, uma gravacao pela
    // metade (uri sem hash, por exemplo) deixaria a rota de download
    // apontando para um arquivo sem como conferir integridade.
    await q.query(`
      ALTER TABLE obra
        ADD CONSTRAINT ck_obra_planta_completa
        CHECK (
          (planta_uri IS NULL AND planta_hash_sha256 IS NULL AND planta_mime IS NULL
           AND planta_atualizada_em IS NULL)
          OR
          (planta_uri IS NOT NULL AND planta_hash_sha256 IS NOT NULL AND planta_mime IS NOT NULL
           AND planta_atualizada_em IS NOT NULL)
        )
    `);

    await q.query(`
      ALTER TABLE obra
        ADD CONSTRAINT ck_obra_planta_tamanho
        CHECK (planta_tamanho_bytes IS NULL OR planta_tamanho_bytes > 0)
    `);

    // Consulta "quais obras ja tem planta" percorre so as que tem.
    await q.query(`CREATE INDEX ix_obra_com_planta ON obra (id) WHERE planta_uri IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS ix_obra_com_planta`);
    await q.query(`
      ALTER TABLE obra
        DROP CONSTRAINT IF EXISTS ck_obra_planta_tamanho,
        DROP CONSTRAINT IF EXISTS ck_obra_planta_completa,
        DROP CONSTRAINT IF EXISTS ck_obra_planta_hash,
        DROP COLUMN IF EXISTS planta_atualizada_em,
        DROP COLUMN IF EXISTS planta_tamanho_bytes,
        DROP COLUMN IF EXISTS planta_hash_sha256,
        DROP COLUMN IF EXISTS planta_mime,
        DROP COLUMN IF EXISTS planta_nome,
        DROP COLUMN IF EXISTS planta_uri
    `);
  }
}
