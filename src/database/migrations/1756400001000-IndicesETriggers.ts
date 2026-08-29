import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indices (inclusive os parciais e o funcional de e-mail) e os triggers que
 * o ORM nao expressa.
 *
 * Os triggers aqui NAO sao a fonte da verdade das regras — sao a rede de
 * seguranca contra UPDATE direto vindo de seed, psql ou de uma rota futura
 * que esqueca a regra. A fonte da verdade e o dominio, em
 * src/qualidade/dominio/, onde as pre-condicoes cruzadas (existe acao
 * concluida? existe verificacao aprovada?) podem ser avaliadas.
 */
export class IndicesETriggers1756400001000 implements MigrationInterface {
  name = 'IndicesETriggers1756400001000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------------- indices
    // E-mail e identidade de login: a unicidade tem que ignorar caixa, senao
    // 'Ana@x.com' e 'ana@x.com' convivem e o login fica ambiguo.
    await q.query(`CREATE UNIQUE INDEX usuario_email_lower_uk ON usuario (lower(email))`);
    await q.query(`CREATE INDEX ix_usuario_papel ON usuario (papel) WHERE ativo`);

    await q.query(`CREATE UNIQUE INDEX ux_obra_codigo ON obra (codigo)`);
    await q.query(`CREATE INDEX ix_obra_responsavel ON obra (responsavel_tecnico_id)`);

    await q.query(
      `CREATE UNIQUE INDEX ux_local_obra_codigo ON local (obra_id, codigo) WHERE codigo IS NOT NULL`,
    );
    await q.query(`CREATE INDEX ix_local_obra ON local (obra_id)`);

    await q.query(`CREATE UNIQUE INDEX ux_modelo_nome_versao ON modelo_ia (nome, versao)`);

    await q.query(
      `CREATE UNIQUE INDEX ux_camera_obra_identificador ON camera (obra_id, identificador)`,
    );
    await q.query(`CREATE INDEX ix_camera_obra ON camera (obra_id)`);
    // Alerta de camera offline: so as ativas interessam.
    await q.query(
      `CREATE INDEX ix_camera_heartbeat ON camera (obra_id, ultimo_heartbeat) WHERE status = 'ATIVA'`,
    );

    await q.query(`CREATE UNIQUE INDEX ux_requisito_norma_item ON requisito_norma (norma, item)`);
    await q.query(`CREATE INDEX ix_requisito_categoria ON requisito_norma (categoria)`);

    await q.query(`CREATE INDEX ix_deteccao_camera_ocorrido ON deteccao (camera_id, ocorrido_em)`);
    // Deduplicacao da camera edge que opera offline e despeja o buffer.
    await q.query(
      `CREATE UNIQUE INDEX ux_deteccao_camera_externo ON deteccao (camera_id, id_externo) WHERE id_externo IS NOT NULL`,
    );
    // A fila de triagem e a tela mais acessada: indice parcial, pequeno.
    await q.query(
      `CREATE INDEX ix_deteccao_pendente ON deteccao (obra_id, ocorrido_em DESC) WHERE status_triagem = 'PENDENTE'`,
    );
    await q.query(`CREATE INDEX ix_deteccao_triador ON deteccao (triado_por)`);

    await q.query(`CREATE UNIQUE INDEX ux_nc_codigo ON nao_conformidade (codigo)`);
    await q.query(
      `CREATE UNIQUE INDEX ux_nc_deteccao ON nao_conformidade (deteccao_id) WHERE deteccao_id IS NOT NULL`,
    );
    await q.query(`CREATE INDEX ix_nc_obra_status ON nao_conformidade (obra_id, status)`);
    await q.query(`CREATE INDEX ix_nc_responsavel ON nao_conformidade (responsavel_id)`);
    await q.query(`CREATE INDEX ix_nc_requisito ON nao_conformidade (requisito_norma_id)`);
    await q.query(`CREATE INDEX ix_nc_reincidencia ON nao_conformidade (reincidencia_de_id)`);
    // Painel: NCs em aberto por obra, ordenadas por urgencia.
    await q.query(
      `CREATE INDEX ix_nc_abertas ON nao_conformidade (obra_id, severidade, prazo) WHERE status NOT IN ('RESOLVIDA','CANCELADA')`,
    );

    await q.query(`CREATE INDEX ix_acao_nc ON acao_corretiva (nao_conformidade_id)`);
    await q.query(`CREATE INDEX ix_acao_executor ON acao_corretiva (executor_id)`);
    // No maximo UMA acao em aberto por NC. O indice e parcial para que a
    // verificacao REPROVADA possa criar uma acao nova sem conflitar com a
    // reprovada, que ja tem concluida_em.
    await q.query(
      `CREATE UNIQUE INDEX ux_acao_em_aberto_por_nc ON acao_corretiva (nao_conformidade_id) WHERE concluida_em IS NULL`,
    );

    await q.query(`CREATE INDEX ix_verificacao_acao ON verificacao (acao_corretiva_id)`);
    await q.query(
      `CREATE UNIQUE INDEX ux_verificacao_aprovada ON verificacao (acao_corretiva_id) WHERE resultado = 'APROVADA'`,
    );

    await q.query(`CREATE INDEX ix_evidencia_nc ON evidencia (nao_conformidade_id)`);
    await q.query(`CREATE INDEX ix_evidencia_deteccao ON evidencia (deteccao_id)`);
    await q.query(`CREATE INDEX ix_evidencia_acao ON evidencia (acao_corretiva_id)`);
    await q.query(`CREATE INDEX ix_evidencia_hash ON evidencia (hash_sha256)`);

    await q.query(`CREATE INDEX ix_relatorio_obra ON relatorio (obra_id)`);
    await q.query(`CREATE INDEX ix_relatorio_item_nc ON relatorio_item (nao_conformidade_id)`);
    await q.query(
      `CREATE UNIQUE INDEX ux_relatorio_item_ordem ON relatorio_item (relatorio_id, ordem)`,
    );

    // ------------------------------------------------------------ sequence
    // Codigo da NC sem colisao sob concorrencia. SEQUENCE, e nunca
    // "SELECT max(codigo)+1": dois engenheiros abrindo NC no mesmo segundo
    // gerariam o mesmo codigo.
    await q.query(`CREATE SEQUENCE seq_nc_codigo`);

    // ------------------------------------------------------------- triggers

    // 1. SEGREGACAO DE FUNCAO — o coracao do desafio.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_verificacao_segregacao() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE v_executor uuid;
      BEGIN
        SELECT executor_id INTO v_executor
          FROM acao_corretiva WHERE id = NEW.acao_corretiva_id;
        IF v_executor IS NOT NULL AND v_executor = NEW.verificado_por THEN
          RAISE EXCEPTION 'Quem executou a acao corretiva nao pode verifica-la'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_verificacao_segregacao
        BEFORE INSERT OR UPDATE ON verificacao
        FOR EACH ROW EXECUTE FUNCTION fn_verificacao_segregacao()
    `);

    // 2. CODIGO E PRAZO da NC, derivados no INSERT.
    //    O prazo vem da severidade: CRITICA 24h, ALTA 72h, MEDIA 7d, BAIXA 15d.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_nc_antes_inserir() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
          NEW.codigo := 'NC-' || to_char(NEW.aberta_em, 'YYYY') || '-' ||
                        lpad(nextval('seq_nc_codigo')::text, 6, '0');
        END IF;
        IF NEW.prazo IS NULL THEN
          NEW.prazo := NEW.aberta_em + CASE NEW.severidade
            WHEN 'CRITICA' THEN interval '24 hours'
            WHEN 'ALTA'    THEN interval '72 hours'
            WHEN 'MEDIA'   THEN interval '7 days'
            ELSE                interval '15 days'
          END;
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_nc_antes_inserir
        BEFORE INSERT ON nao_conformidade
        FOR EACH ROW EXECUTE FUNCTION fn_nc_antes_inserir()
    `);

    // 3. CODIGO DA NC e IMUTAVEL. Ele aparece em relatorio impresso e em
    //    auditoria: se mudar depois de emitido, o documento passa a mentir.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_nc_codigo_imutavel() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
          RAISE EXCEPTION 'O codigo da nao conformidade e imutavel'
            USING ERRCODE = '0A000';
        END IF;
        IF NEW.aberta_em IS DISTINCT FROM OLD.aberta_em THEN
          RAISE EXCEPTION 'A data de abertura da nao conformidade e imutavel'
            USING ERRCODE = '0A000';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_nc_codigo_imutavel
        BEFORE UPDATE ON nao_conformidade
        FOR EACH ROW EXECUTE FUNCTION fn_nc_codigo_imutavel()
    `);

    // 4. CADEIA DE CUSTODIA: evidencia e verificacao sao append-only.
    //    Sem isto, "evidencia imutavel" e promessa, nao garantia.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_bloquear_alteracao() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Registro de % faz parte da cadeia de custodia e nao pode ser alterado nem removido', TG_TABLE_NAME
          USING ERRCODE = '0A000';
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_evidencia_imutavel
        BEFORE UPDATE OR DELETE ON evidencia
        FOR EACH ROW EXECUTE FUNCTION fn_bloquear_alteracao()
    `);
    await q.query(`
      CREATE TRIGGER trg_verificacao_imutavel
        BEFORE UPDATE OR DELETE ON verificacao
        FOR EACH ROW EXECUTE FUNCTION fn_bloquear_alteracao()
    `);

    // 5. VERSAO DE MODELO IMUTAVEL: o DBML manda "nunca faca UPDATE, cada
    //    versao e uma linha nova". Se a versao mudasse, toda deteccao antiga
    //    passaria a apontar para um modelo que nao foi o que a produziu —
    //    perda de rastreabilidade.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_modelo_ia_imutavel() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.nome IS DISTINCT FROM OLD.nome
           OR NEW.versao IS DISTINCT FROM OLD.versao
           OR NEW.tipo_deteccao IS DISTINCT FROM OLD.tipo_deteccao
           OR NEW.hash_artefato IS DISTINCT FROM OLD.hash_artefato
           OR NEW.metricas IS DISTINCT FROM OLD.metricas
           OR NEW.publicado_em IS DISTINCT FROM OLD.publicado_em THEN
          RAISE EXCEPTION 'Versao de modelo e imutavel: publique uma versao nova. Apenas ativo e limiar_confianca podem mudar'
            USING ERRCODE = '0A000';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_modelo_ia_imutavel
        BEFORE UPDATE ON modelo_ia
        FOR EACH ROW EXECUTE FUNCTION fn_modelo_ia_imutavel()
    `);

    // 6. COERENCIA obra/local: um local de outra obra na NC ou na camera
    //    corromperia todo agrupamento do painel. FK simples nao alcanca isso.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_local_pertence_a_obra() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE v_obra uuid;
      BEGIN
        IF NEW.local_id IS NULL THEN RETURN NEW; END IF;
        SELECT obra_id INTO v_obra FROM local WHERE id = NEW.local_id;
        IF v_obra IS DISTINCT FROM NEW.obra_id THEN
          RAISE EXCEPTION 'O local informado pertence a outra obra'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_camera_local_obra
        BEFORE INSERT OR UPDATE ON camera
        FOR EACH ROW EXECUTE FUNCTION fn_local_pertence_a_obra()
    `);
    await q.query(`
      CREATE TRIGGER trg_nc_local_obra
        BEFORE INSERT OR UPDATE ON nao_conformidade
        FOR EACH ROW EXECUTE FUNCTION fn_local_pertence_a_obra()
    `);

    // 7. DETECCAO: obra_id vem da camera (nunca do cliente) e e imutavel.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_deteccao_obra_da_camera() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        SELECT obra_id INTO NEW.obra_id FROM camera WHERE id = NEW.camera_id;
        IF NEW.obra_id IS NULL THEN
          RAISE EXCEPTION 'Camera % nao encontrada', NEW.camera_id USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_deteccao_obra_da_camera
        BEFORE INSERT ON deteccao
        FOR EACH ROW EXECUTE FUNCTION fn_deteccao_obra_da_camera()
    `);

    // 8. NC de origem IA so nasce de deteccao CONFIRMADA e da mesma obra.
    //    FALSO_POSITIVO e DUPLICADA nunca viram NC.
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_nc_deteccao_coerente() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE v_obra uuid; v_status status_triagem;
      BEGIN
        IF NEW.deteccao_id IS NULL THEN RETURN NEW; END IF;
        SELECT obra_id, status_triagem INTO v_obra, v_status
          FROM deteccao WHERE id = NEW.deteccao_id;
        IF v_obra IS DISTINCT FROM NEW.obra_id THEN
          RAISE EXCEPTION 'A deteccao pertence a outra obra' USING ERRCODE = '23514';
        END IF;
        IF v_status <> 'CONFIRMADA' THEN
          RAISE EXCEPTION 'Apenas deteccao com triagem CONFIRMADA pode gerar nao conformidade (atual: %)', v_status
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await q.query(`
      CREATE TRIGGER trg_nc_deteccao_coerente
        BEFORE INSERT ON nao_conformidade
        FOR EACH ROW EXECUTE FUNCTION fn_nc_deteccao_coerente()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const triggers: Array<[string, string]> = [
      ['trg_verificacao_segregacao', 'verificacao'],
      ['trg_verificacao_imutavel', 'verificacao'],
      ['trg_nc_antes_inserir', 'nao_conformidade'],
      ['trg_nc_codigo_imutavel', 'nao_conformidade'],
      ['trg_nc_local_obra', 'nao_conformidade'],
      ['trg_nc_deteccao_coerente', 'nao_conformidade'],
      ['trg_evidencia_imutavel', 'evidencia'],
      ['trg_modelo_ia_imutavel', 'modelo_ia'],
      ['trg_camera_local_obra', 'camera'],
      ['trg_deteccao_obra_da_camera', 'deteccao'],
    ];
    for (const [trigger, tabela] of triggers) {
      await q.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${tabela}`);
    }
    for (const fn of [
      'fn_verificacao_segregacao',
      'fn_nc_antes_inserir',
      'fn_nc_codigo_imutavel',
      'fn_bloquear_alteracao',
      'fn_modelo_ia_imutavel',
      'fn_local_pertence_a_obra',
      'fn_deteccao_obra_da_camera',
      'fn_nc_deteccao_coerente',
    ]) {
      await q.query(`DROP FUNCTION IF EXISTS ${fn}() CASCADE`);
    }
    await q.query(`DROP SEQUENCE IF EXISTS seq_nc_codigo`);
  }
}
