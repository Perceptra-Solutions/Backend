import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historico append-only das transicoes da nao conformidade.
 *
 * O MER nao tem nenhuma tabela de auditoria: ninguem sabe quem mudou o
 * status, quando nem por que. Para um desafio PBQP-H isso e a lacuna mais
 * cara — e o que um auditor pede primeiro.
 *
 * O registro e feito por TRIGGER, e nao pelo servico, para que um UPDATE
 * vindo de script, psql ou de uma rota futura tambem seja capturado. O ator
 * chega pela variavel de sessao `perceptra.ator_id`, definida com SET LOCAL
 * dentro da mesma transacao: e assim que um trigger, que nao conhece o JWT,
 * descobre quem agiu. Quando ninguem define (seed, migration), fica NULL e
 * o registro consta como alteracao de sistema.
 */
export class AuditoriaNc1756400002000 implements MigrationInterface {
  name = 'AuditoriaNc1756400002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE nao_conformidade_evento (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nao_conformidade_id uuid NOT NULL REFERENCES nao_conformidade(id) ON DELETE RESTRICT,
        de                  status_nc,
        para                status_nc NOT NULL,
        ator_id             uuid REFERENCES usuario(id) ON DELETE RESTRICT,
        motivo              text,
        ocorrido_em         timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(
      `CREATE INDEX ix_nc_evento_nc ON nao_conformidade_evento (nao_conformidade_id, ocorrido_em)`,
    );
    await q.query(`CREATE INDEX ix_nc_evento_ator ON nao_conformidade_evento (ator_id)`);

    // Le a variavel de sessao com o segundo argumento `true` (missing_ok):
    // sem ele, um UPDATE fora de uma transacao preparada levantaria erro em
    // vez de registrar como alteracao de sistema.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_nc_registrar_evento() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_ator   text := current_setting('perceptra.ator_id', true);
        v_motivo text := current_setting('perceptra.motivo', true);
      BEGIN
        INSERT INTO nao_conformidade_evento (nao_conformidade_id, de, para, ator_id, motivo)
        VALUES (
          NEW.id,
          OLD.status,
          NEW.status,
          NULLIF(v_ator, '')::uuid,
          NULLIF(v_motivo, '')
        );
        RETURN NEW;
      END $$;
    `);

    // WHEN garante que so a mudanca de status gera evento: sem ele, editar a
    // descricao da NC poluiria a linha do tempo com ruido.
    await q.query(`
      CREATE TRIGGER trg_nc_registrar_evento
        AFTER UPDATE OF status ON nao_conformidade
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION fn_nc_registrar_evento()
    `);

    // A abertura tambem e um evento: sem isto a linha do tempo comeca no ar,
    // sem dizer quem abriu a NC.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_nc_registrar_abertura() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE v_ator text := current_setting('perceptra.ator_id', true);
      BEGIN
        INSERT INTO nao_conformidade_evento (nao_conformidade_id, de, para, ator_id, motivo)
        VALUES (NEW.id, NULL, NEW.status, NULLIF(v_ator, '')::uuid, 'Abertura da nao conformidade');
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_nc_registrar_abertura
        AFTER INSERT ON nao_conformidade
        FOR EACH ROW EXECUTE FUNCTION fn_nc_registrar_abertura()
    `);

    // Append-only: o historico nao vale nada se puder ser reescrito.
    await q.query(`
      CREATE TRIGGER trg_nc_evento_imutavel
        BEFORE UPDATE OR DELETE ON nao_conformidade_evento
        FOR EACH ROW EXECUTE FUNCTION fn_bloquear_alteracao()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS trg_nc_evento_imutavel ON nao_conformidade_evento`);
    await q.query(`DROP TRIGGER IF EXISTS trg_nc_registrar_evento ON nao_conformidade`);
    await q.query(`DROP TRIGGER IF EXISTS trg_nc_registrar_abertura ON nao_conformidade`);
    await q.query(`DROP FUNCTION IF EXISTS fn_nc_registrar_evento() CASCADE`);
    await q.query(`DROP FUNCTION IF EXISTS fn_nc_registrar_abertura() CASCADE`);
    await q.query(`DROP TABLE IF EXISTS nao_conformidade_evento`);
  }
}
