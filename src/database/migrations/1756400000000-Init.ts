import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial: os 11 enums nativos, as 13 tabelas do MER, as chaves
 * estrangeiras com ON DELETE explicito e todos os CHECK dos comentarios do DBML.
 *
 * Escrita a mao, e nao gerada: os CHECK, os indices parciais e as FKs com
 * politica de delete sao justamente o que o `migration:generate` nao produz
 * bem — e sao eles que carregam as invariantes do dominio.
 */
export class Init1756400000000 implements MigrationInterface {
  name = 'Init1756400000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------- enums
    await q.query(`CREATE TYPE papel_usuario AS ENUM ('GESTOR','ENGENHEIRO')`);
    await q.query(
      `CREATE TYPE status_obra AS ENUM ('PLANEJAMENTO','EM_ANDAMENTO','PARALISADA','CONCLUIDA')`,
    );
    await q.query(
      `CREATE TYPE tipo_local AS ENUM ('BLOCO','PAVIMENTO','UNIDADE','AMBIENTE','AREA_COMUM','EXTERNO')`,
    );
    await q.query(`CREATE TYPE status_camera AS ENUM ('ATIVA','OFFLINE','MANUTENCAO')`);
    await q.query(
      `CREATE TYPE status_triagem AS ENUM ('PENDENTE','CONFIRMADA','FALSO_POSITIVO','DUPLICADA')`,
    );
    await q.query(`CREATE TYPE tipo_evidencia AS ENUM ('FOTO','VIDEO','DOCUMENTO')`);
    await q.query(`CREATE TYPE origem_registro AS ENUM ('IA','MANUAL')`);
    await q.query(
      `CREATE TYPE categoria_desempenho AS ENUM ('TERMICO','ACUSTICO','ESTANQUEIDADE','ESTRUTURAL','SEGURANCA_FOGO','DURABILIDADE','OUTRO')`,
    );
    await q.query(`CREATE TYPE severidade_nc AS ENUM ('BAIXA','MEDIA','ALTA','CRITICA')`);
    await q.query(
      `CREATE TYPE status_nc AS ENUM ('ABERTA','EM_CORRECAO','AGUARDANDO_VERIFICACAO','RESOLVIDA','CANCELADA')`,
    );
    await q.query(`CREATE TYPE resultado_verificacao AS ENUM ('APROVADA','REPROVADA')`);
    await q.query(`CREATE TYPE tipo_relatorio AS ENUM ('NAO_CONFORMIDADE','PERIODICO','OBRA')`);

    // --------------------------------------------------------------- tabelas
    await q.query(`
      CREATE TABLE usuario (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome       text NOT NULL,
        email      text NOT NULL,
        senha_hash text NOT NULL,
        papel      papel_usuario NOT NULL,
        crea       text,
        ativo      boolean NOT NULL DEFAULT true,
        criado_em  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_usuario_crea CHECK (crea IS NULL OR papel = 'ENGENHEIRO')
      )`);

    await q.query(`
      CREATE TABLE obra (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo                 text NOT NULL,
        nome                   text NOT NULL,
        endereco               text,
        cidade                 text,
        uf                     char(2),
        status                 status_obra NOT NULL DEFAULT 'EM_ANDAMENTO',
        responsavel_tecnico_id uuid,
        inicio_previsto        date,
        fim_previsto           date,
        criado_em              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_obra_datas CHECK (fim_previsto IS NULL OR inicio_previsto IS NULL OR fim_previsto >= inicio_previsto),
        CONSTRAINT ck_obra_uf CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$')
      )`);

    await q.query(`
      CREATE TABLE local (
        id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        obra_id uuid NOT NULL,
        tipo    tipo_local NOT NULL,
        nome    text NOT NULL,
        codigo  text
      )`);

    await q.query(`
      CREATE TABLE modelo_ia (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome             text NOT NULL,
        versao           text NOT NULL,
        tipo_deteccao    text NOT NULL,
        limiar_confianca numeric(4,3) NOT NULL DEFAULT 0.7,
        metricas         jsonb,
        hash_artefato    text,
        publicado_em     date NOT NULL DEFAULT CURRENT_DATE,
        ativo            boolean NOT NULL DEFAULT true,
        CONSTRAINT ck_modelo_limiar CHECK (limiar_confianca >= 0 AND limiar_confianca <= 1)
      )`);

    await q.query(`
      CREATE TABLE camera (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        obra_id          uuid NOT NULL,
        local_id         uuid,
        modelo_ia_id     uuid,
        identificador    text NOT NULL,
        fabricante       text,
        url_stream       text,
        protocolo        text NOT NULL DEFAULT 'RTSP',
        status           status_camera NOT NULL DEFAULT 'ATIVA',
        instalada_em     date,
        ultimo_heartbeat timestamptz,
        CONSTRAINT ck_camera_stream_cifrado CHECK (url_stream IS NULL OR url_stream LIKE 'enc:v1:%')
      )`);

    await q.query(`
      CREATE TABLE requisito_norma (
        id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        norma     text NOT NULL,
        item      text NOT NULL,
        categoria categoria_desempenho NOT NULL,
        descricao text NOT NULL
      )`);

    await q.query(`
      CREATE TABLE deteccao (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        camera_id       uuid NOT NULL,
        obra_id         uuid NOT NULL,
        modelo_ia_id    uuid NOT NULL,
        id_externo      text,
        classe          text NOT NULL,
        confianca       numeric(4,3) NOT NULL,
        bbox            jsonb,
        ocorrido_em     timestamptz NOT NULL,
        recebido_em     timestamptz NOT NULL DEFAULT now(),
        status_triagem  status_triagem NOT NULL DEFAULT 'PENDENTE',
        triado_por      uuid,
        triado_em       timestamptz,
        duplicada_de_id uuid,
        CONSTRAINT ck_deteccao_confianca CHECK (confianca >= 0 AND confianca <= 1),
        CONSTRAINT ck_deteccao_triagem CHECK ((status_triagem = 'PENDENTE') = (triado_por IS NULL AND triado_em IS NULL)),
        CONSTRAINT ck_deteccao_duplicada CHECK (duplicada_de_id IS DISTINCT FROM id),
        CONSTRAINT ck_deteccao_duplicada_status CHECK (status_triagem = 'DUPLICADA' OR duplicada_de_id IS NULL)
      )`);

    await q.query(`
      CREATE TABLE nao_conformidade (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        obra_id            uuid NOT NULL,
        local_id           uuid,
        deteccao_id        uuid,
        requisito_norma_id uuid,
        responsavel_id     uuid,
        reincidencia_de_id uuid,
        codigo             text NOT NULL,
        origem             origem_registro NOT NULL,
        titulo             text NOT NULL,
        descricao          text,
        severidade         severidade_nc NOT NULL,
        status             status_nc NOT NULL DEFAULT 'ABERTA',
        prazo              timestamptz,
        aberta_em          timestamptz NOT NULL DEFAULT now(),
        fechada_em         timestamptz,
        CONSTRAINT ck_nc_origem CHECK ((origem = 'IA' AND deteccao_id IS NOT NULL) OR (origem = 'MANUAL' AND deteccao_id IS NULL)),
        CONSTRAINT ck_nc_fechamento CHECK ((status IN ('RESOLVIDA','CANCELADA')) = (fechada_em IS NOT NULL)),
        CONSTRAINT ck_nc_fechada_apos_abertura CHECK (fechada_em IS NULL OR fechada_em >= aberta_em),
        CONSTRAINT ck_nc_reincidencia CHECK (reincidencia_de_id IS DISTINCT FROM id)
      )`);

    await q.query(`
      CREATE TABLE acao_corretiva (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nao_conformidade_id uuid NOT NULL,
        executor_id         uuid NOT NULL,
        descricao           text NOT NULL,
        causa_raiz          text,
        prazo               date,
        iniciada_em         timestamptz NOT NULL DEFAULT now(),
        concluida_em        timestamptz,
        custo               numeric(12,2),
        CONSTRAINT ck_acao_datas CHECK (concluida_em IS NULL OR concluida_em >= iniciada_em),
        CONSTRAINT ck_acao_custo CHECK (custo IS NULL OR custo >= 0)
      )`);

    await q.query(`
      CREATE TABLE verificacao (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        acao_corretiva_id uuid NOT NULL,
        verificado_por    uuid NOT NULL,
        resultado         resultado_verificacao NOT NULL,
        parecer           text,
        verificado_em     timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE evidencia (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo                tipo_evidencia NOT NULL,
        uri                 text NOT NULL,
        hash_sha256         char(64) NOT NULL,
        origem              origem_registro NOT NULL,
        autor_id            uuid,
        deteccao_id         uuid,
        nao_conformidade_id uuid,
        acao_corretiva_id   uuid,
        capturado_em        timestamptz NOT NULL DEFAULT now(),
        criado_em           timestamptz NOT NULL DEFAULT now(),
        tamanho_bytes       bigint,
        mime                text,
        CONSTRAINT ck_evidencia_vinculo CHECK (num_nonnulls(deteccao_id, nao_conformidade_id, acao_corretiva_id) >= 1),
        CONSTRAINT ck_evidencia_hash CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_evidencia_origem_autor CHECK ((origem = 'MANUAL' AND autor_id IS NOT NULL) OR (origem = 'IA' AND autor_id IS NULL)),
        CONSTRAINT ck_evidencia_tamanho CHECK (tamanho_bytes IS NULL OR tamanho_bytes > 0)
      )`);

    await q.query(`
      CREATE TABLE relatorio (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        obra_id        uuid NOT NULL,
        gerado_por     uuid,
        tipo           tipo_relatorio NOT NULL,
        titulo         text NOT NULL,
        periodo_inicio date,
        periodo_fim    date,
        arquivo_uri    text,
        hash_sha256    char(64),
        gerado_em      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_relatorio_periodo CHECK ((periodo_inicio IS NULL AND periodo_fim IS NULL) OR (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL AND periodo_fim >= periodo_inicio)),
        CONSTRAINT ck_relatorio_periodico_exige_periodo CHECK (tipo <> 'PERIODICO' OR (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL)),
        CONSTRAINT ck_relatorio_hash CHECK (hash_sha256 IS NULL OR hash_sha256 ~ '^[0-9a-f]{64}$')
      )`);

    await q.query(`
      CREATE TABLE relatorio_item (
        relatorio_id        uuid NOT NULL,
        nao_conformidade_id uuid NOT NULL,
        ordem               int NOT NULL DEFAULT 1,
        PRIMARY KEY (relatorio_id, nao_conformidade_id),
        CONSTRAINT ck_relatorio_item_ordem CHECK (ordem > 0)
      )`);

    // ------------------------------------------------------------------ FKs
    // RESTRICT em tudo que e prova (deteccao, evidencia, verificacao,
    // modelo_ia, NC): nada que sustenta uma auditoria pode sumir por cascata.
    // CASCADE so em relatorio_item, que e filho puro do relatorio.
    const fks: Array<[string, string, string, string, string]> = [
      ['obra', 'fk_obra_responsavel', 'responsavel_tecnico_id', 'usuario', 'RESTRICT'],
      ['local', 'fk_local_obra', 'obra_id', 'obra', 'RESTRICT'],
      ['camera', 'fk_camera_obra', 'obra_id', 'obra', 'RESTRICT'],
      ['camera', 'fk_camera_local', 'local_id', 'local', 'SET NULL'],
      ['camera', 'fk_camera_modelo', 'modelo_ia_id', 'modelo_ia', 'RESTRICT'],
      ['deteccao', 'fk_deteccao_camera', 'camera_id', 'camera', 'RESTRICT'],
      ['deteccao', 'fk_deteccao_obra', 'obra_id', 'obra', 'RESTRICT'],
      ['deteccao', 'fk_deteccao_modelo', 'modelo_ia_id', 'modelo_ia', 'RESTRICT'],
      ['deteccao', 'fk_deteccao_triador', 'triado_por', 'usuario', 'RESTRICT'],
      ['deteccao', 'fk_deteccao_duplicada', 'duplicada_de_id', 'deteccao', 'RESTRICT'],
      ['nao_conformidade', 'fk_nc_obra', 'obra_id', 'obra', 'RESTRICT'],
      ['nao_conformidade', 'fk_nc_local', 'local_id', 'local', 'SET NULL'],
      ['nao_conformidade', 'fk_nc_deteccao', 'deteccao_id', 'deteccao', 'RESTRICT'],
      ['nao_conformidade', 'fk_nc_requisito', 'requisito_norma_id', 'requisito_norma', 'RESTRICT'],
      ['nao_conformidade', 'fk_nc_responsavel', 'responsavel_id', 'usuario', 'RESTRICT'],
      [
        'nao_conformidade',
        'fk_nc_reincidencia',
        'reincidencia_de_id',
        'nao_conformidade',
        'RESTRICT',
      ],
      ['acao_corretiva', 'fk_acao_nc', 'nao_conformidade_id', 'nao_conformidade', 'RESTRICT'],
      ['acao_corretiva', 'fk_acao_executor', 'executor_id', 'usuario', 'RESTRICT'],
      ['verificacao', 'fk_verificacao_acao', 'acao_corretiva_id', 'acao_corretiva', 'RESTRICT'],
      ['verificacao', 'fk_verificacao_usuario', 'verificado_por', 'usuario', 'RESTRICT'],
      ['evidencia', 'fk_evidencia_autor', 'autor_id', 'usuario', 'RESTRICT'],
      ['evidencia', 'fk_evidencia_deteccao', 'deteccao_id', 'deteccao', 'RESTRICT'],
      ['evidencia', 'fk_evidencia_nc', 'nao_conformidade_id', 'nao_conformidade', 'RESTRICT'],
      ['evidencia', 'fk_evidencia_acao', 'acao_corretiva_id', 'acao_corretiva', 'RESTRICT'],
      ['relatorio', 'fk_relatorio_obra', 'obra_id', 'obra', 'RESTRICT'],
      ['relatorio', 'fk_relatorio_gerador', 'gerado_por', 'usuario', 'RESTRICT'],
      ['relatorio_item', 'fk_relatorio_item_relatorio', 'relatorio_id', 'relatorio', 'CASCADE'],
      [
        'relatorio_item',
        'fk_relatorio_item_nc',
        'nao_conformidade_id',
        'nao_conformidade',
        'RESTRICT',
      ],
    ];

    for (const [tabela, nome, coluna, alvo, onDelete] of fks) {
      await q.query(
        `ALTER TABLE ${tabela} ADD CONSTRAINT ${nome} FOREIGN KEY (${coluna}) ` +
          `REFERENCES ${alvo}(id) ON DELETE ${onDelete} ON UPDATE RESTRICT`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabela of [
      'relatorio_item',
      'relatorio',
      'evidencia',
      'verificacao',
      'acao_corretiva',
      'nao_conformidade',
      'deteccao',
      'requisito_norma',
      'camera',
      'modelo_ia',
      'local',
      'obra',
      'usuario',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${tabela} CASCADE`);
    }
    for (const tipo of [
      'tipo_relatorio',
      'resultado_verificacao',
      'status_nc',
      'severidade_nc',
      'categoria_desempenho',
      'origem_registro',
      'tipo_evidencia',
      'status_triagem',
      'status_camera',
      'tipo_local',
      'status_obra',
      'papel_usuario',
    ]) {
      await q.query(`DROP TYPE IF EXISTS ${tipo}`);
    }
  }
}
