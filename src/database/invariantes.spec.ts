import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoComMigrations, type BancoEmMemoria } from './pglite-runner.js';

/**
 * Verifica que as invariantes do MER estao realmente aplicadas no banco —
 * nao que o codigo TypeScript acha que estao.
 *
 * Roda contra as migrations REAIS num Postgres 18 em processo (PGlite), sem
 * Docker, sem psql e sem servidor: `npm test` cobre isso em qualquer maquina
 * e no CI.
 *
 * O que estes testes protegem: cada regra abaixo tambem sera validada na
 * aplicacao, com mensagem amigavel. O banco e a rede de seguranca contra
 * seed, script e rota futura que esquecam a regra — e e ele que faz a
 * diferenca numa auditoria.
 */
describe('Invariantes do schema', () => {
  let db: BancoEmMemoria;
  let engenheiroA: string;
  let engenheiroB: string;
  let obra: string;
  let outraObra: string;
  let local: string;
  let localDeOutraObra: string;
  let modelo: string;
  let camera: string;
  let requisito: string;

  const HASH_VALIDO = 'a'.repeat(64);

  /** Executa e devolve a primeira linha. */
  async function um<T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> {
    const linhas = await db.query<T>(sql, params);
    return linhas[0];
  }

  /** Captura o SQLSTATE de uma operacao que deve falhar. */
  async function codigoDoErro(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await db.query(sql, params);
      return 'NENHUM_ERRO';
    } catch (e) {
      return (e as { code?: string }).code ?? 'SEM_CODIGO';
    }
  }

  beforeAll(async () => {
    db = await criarBancoComMigrations();
  }, 60_000);

  afterAll(async () => {
    await db?.fechar();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE evidencia, verificacao, acao_corretiva, nao_conformidade,
      deteccao, camera, local, requisito_norma, modelo_ia, obra, usuario,
      relatorio_item, relatorio RESTART IDENTITY CASCADE`);

    engenheiroA = (
      await um(`INSERT INTO usuario (nome,email,senha_hash,papel,crea)
                VALUES ('Eng A','a@x.com','h','ENGENHEIRO','MG-1') RETURNING id`)
    ).id;
    engenheiroB = (
      await um(`INSERT INTO usuario (nome,email,senha_hash,papel,crea)
                VALUES ('Eng B','b@x.com','h','ENGENHEIRO','MG-2') RETURNING id`)
    ).id;
    obra = (
      await um(`INSERT INTO obra (codigo,nome,responsavel_tecnico_id,uf)
                VALUES ('OB-1','Residencial Aurora',$1,'MG') RETURNING id`, [engenheiroA])
    ).id;
    outraObra = (
      await um(`INSERT INTO obra (codigo,nome) VALUES ('OB-2','Outra Obra') RETURNING id`)
    ).id;
    local = (
      await um(`INSERT INTO local (obra_id,tipo,nome,codigo)
                VALUES ($1,'AMBIENTE','Torre B / 7 pav / apto 703 / banheiro','B-703-BAN') RETURNING id`, [obra])
    ).id;
    localDeOutraObra = (
      await um(`INSERT INTO local (obra_id,tipo,nome) VALUES ($1,'BLOCO','Bloco X') RETURNING id`, [outraObra])
    ).id;
    modelo = (
      await um(`INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
                VALUES ('trinca-detector','1.2.0','TRINCA',0.700) RETURNING id`)
    ).id;
    camera = (
      await um(`INSERT INTO camera (obra_id,local_id,modelo_ia_id,identificador)
                VALUES ($1,$2,$3,'CAM-07') RETURNING id`, [obra, local, modelo])
    ).id;
    requisito = (
      await um(`INSERT INTO requisito_norma (norma,item,categoria,descricao)
                VALUES ('NBR 15575','Parte 3 - 11.2','ESTANQUEIDADE','Estanqueidade a agua') RETURNING id`)
    ).id;
  });

  /** Cria uma deteccao ja triada como CONFIRMADA — o pre-requisito da NC de origem IA. */
  async function deteccaoConfirmada(idExterno = 'cam07-001'): Promise<string> {
    const { id } = await um(
      `INSERT INTO deteccao (camera_id,modelo_ia_id,id_externo,classe,confianca,ocorrido_em,obra_id)
       VALUES ($1,$2,$3,'TRINCA',0.910,now(),$4) RETURNING id`,
      [camera, modelo, idExterno, obra],
    );
    await db.query(
      `UPDATE deteccao SET status_triagem='CONFIRMADA', triado_por=$1, triado_em=now() WHERE id=$2`,
      [engenheiroA, id],
    );
    return id;
  }

  async function ncDeDeteccao(severidade = 'ALTA') {
    const det = await deteccaoConfirmada(`cam07-${severidade}`);
    return um<{ id: string; codigo: string; prazo: string; aberta_em: string }>(
      `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,origem,titulo,severidade)
       VALUES ($1,$2,$3,$4,$5,'IA','Trinca em alvenaria',$6) RETURNING id, codigo, prazo, aberta_em`,
      [obra, local, det, requisito, engenheiroA, severidade],
    );
  }

  describe('identidade', () => {
    it('impede CREA em gestor (CREA e do engenheiro)', async () => {
      expect(
        await codigoDoErro(`INSERT INTO usuario (nome,email,senha_hash,papel,crea)
                            VALUES ('X','x@x.com','h','GESTOR','MG-9')`),
      ).toBe('23514');
    });

    it('trata e-mail como identidade unica ignorando caixa', async () => {
      expect(
        await codigoDoErro(`INSERT INTO usuario (nome,email,senha_hash,papel)
                            VALUES ('Y','A@X.COM','h','GESTOR')`),
      ).toBe('23505');
    });
  });

  describe('coerencia obra/local', () => {
    it('recusa camera apontando para local de outra obra', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO camera (obra_id,local_id,identificador) VALUES ($1,$2,'CAM-99')`,
          [obra, localDeOutraObra],
        ),
      ).toBe('23514');
    });

    it('recusa NC apontando para local de outra obra', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,local_id,origem,titulo,severidade)
           VALUES ($1,$2,'MANUAL','X','ALTA')`,
          [obra, localDeOutraObra],
        ),
      ).toBe('23514');
    });
  });

  describe('camera', () => {
    it('recusa url_stream em texto plano (carrega credencial RTSP)', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO camera (obra_id,identificador,url_stream)
           VALUES ($1,'CAM-98','rtsp://user:senha@10.0.0.1/stream')`,
          [obra],
        ),
      ).toBe('23514');
    });

    it('aceita url_stream no envelope cifrado enc:v1:', async () => {
      const { id } = await um(
        `INSERT INTO camera (obra_id,identificador,url_stream)
         VALUES ($1,'CAM-97','enc:v1:aXY=:dGFn:Y3Q=') RETURNING id`,
        [obra],
      );
      expect(id).toBeTruthy();
    });
  });

  describe('rastreabilidade do modelo de IA', () => {
    it('congela a versao publicada: cada versao e uma linha nova', async () => {
      expect(await codigoDoErro(`UPDATE modelo_ia SET versao='9.9.9' WHERE id=$1`, [modelo])).toBe(
        '0A000',
      );
      expect(
        await codigoDoErro(`UPDATE modelo_ia SET tipo_deteccao='EPI' WHERE id=$1`, [modelo]),
      ).toBe('0A000');
    });

    it('permite aposentar o modelo, que e o unico UPDATE legitimo', async () => {
      await db.query(`UPDATE modelo_ia SET ativo=false WHERE id=$1`, [modelo]);
      const { ativo } = await um<{ ativo: boolean }>(`SELECT ativo FROM modelo_ia WHERE id=$1`, [modelo]);
      expect(ativo).toBe(false);
    });

    it('mantem o limiar de confianca dentro de [0,1]', async () => {
      expect(
        await codigoDoErro(`INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
                            VALUES ('m','9','X',1.5)`),
      ).toBe('23514');
    });
  });

  describe('deteccao', () => {
    it('preenche obra_id a partir da camera, sem confiar no cliente', async () => {
      const { obra_id } = await um<{ obra_id: string }>(
        `INSERT INTO deteccao (camera_id,modelo_ia_id,classe,confianca,ocorrido_em,obra_id)
         VALUES ($1,$2,'TRINCA',0.9,now(),$3) RETURNING obra_id`,
        // Manda a obra ERRADA de proposito: o trigger tem que sobrescrever.
        [camera, modelo, outraObra],
      );
      expect(obra_id).toBe(obra);
    });

    it('mantem a confianca dentro de [0,1]', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO deteccao (camera_id,modelo_ia_id,classe,confianca,ocorrido_em,obra_id)
           VALUES ($1,$2,'TRINCA',1.5,now(),$3)`,
          [camera, modelo, obra],
        ),
      ).toBe('23514');
    });

    it('exige quem triou e quando para sair de PENDENTE', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO deteccao (camera_id,modelo_ia_id,classe,confianca,ocorrido_em,obra_id,triado_por,triado_em)
           VALUES ($1,$2,'TRINCA',0.9,now(),$3,$4,now())`,
          [camera, modelo, obra, engenheiroA],
        ),
      ).toBe('23514');
    });

    it('deduplica reenvio da camera que voltou do offline (id_externo)', async () => {
      await db.query(
        `INSERT INTO deteccao (camera_id,modelo_ia_id,id_externo,classe,confianca,ocorrido_em,obra_id)
         VALUES ($1,$2,'cam07-001','TRINCA',0.91,now(),$3)`,
        [camera, modelo, obra],
      );
      expect(
        await codigoDoErro(
          `INSERT INTO deteccao (camera_id,modelo_ia_id,id_externo,classe,confianca,ocorrido_em,obra_id)
           VALUES ($1,$2,'cam07-001','TRINCA',0.91,now(),$3)`,
          [camera, modelo, obra],
        ),
      ).toBe('23505');
    });
  });

  describe('nao conformidade', () => {
    it('so nasce de deteccao CONFIRMADA — falso positivo nunca vira NC', async () => {
      const { id } = await um(
        `INSERT INTO deteccao (camera_id,modelo_ia_id,classe,confianca,ocorrido_em,obra_id)
         VALUES ($1,$2,'TRINCA',0.9,now(),$3) RETURNING id`,
        [camera, modelo, obra],
      );
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,deteccao_id,origem,titulo,severidade)
           VALUES ($1,$2,'IA','Trinca','ALTA')`,
          [obra, id],
        ),
      ).toBe('23514');
    });

    it('exige deteccao quando origem e IA e proibe quando e MANUAL', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,origem,titulo,severidade) VALUES ($1,'IA','X','ALTA')`,
          [obra],
        ),
      ).toBe('23514');

      const det = await deteccaoConfirmada('cam07-manual');
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,deteccao_id,origem,titulo,severidade)
           VALUES ($1,$2,'MANUAL','X','ALTA')`,
          [obra, det],
        ),
      ).toBe('23514');
    });

    it('gera codigo unico e sequencial sem colisao', async () => {
      const primeira = await ncDeDeteccao('ALTA');
      const segunda = await um<{ codigo: string }>(
        `INSERT INTO nao_conformidade (obra_id,origem,titulo,severidade)
         VALUES ($1,'MANUAL','Outra','BAIXA') RETURNING codigo`,
        [obra],
      );

      expect(primeira.codigo).toMatch(/^NC-\d{4}-\d{6}$/);
      expect(segunda.codigo).toMatch(/^NC-\d{4}-\d{6}$/);
      expect(primeira.codigo).not.toBe(segunda.codigo);
    });

    it.each([
      ['CRITICA', 24],
      ['ALTA', 72],
      ['MEDIA', 24 * 7],
      ['BAIXA', 24 * 15],
    ])('deriva o prazo da severidade %s em %ih', async (severidade, horasEsperadas) => {
      const nc = await um<{ prazo: string; aberta_em: string }>(
        `INSERT INTO nao_conformidade (obra_id,origem,titulo,severidade)
         VALUES ($1,'MANUAL','X',$2) RETURNING prazo, aberta_em`,
        [obra, severidade],
      );
      const horas =
        (new Date(nc.prazo).getTime() - new Date(nc.aberta_em).getTime()) / 3_600_000;
      expect(horas).toBe(horasEsperadas);
    });

    it('permite no maximo uma NC por deteccao (protege contra duplo clique)', async () => {
      const det = await deteccaoConfirmada('cam07-dupla');
      await db.query(
        `INSERT INTO nao_conformidade (obra_id,deteccao_id,origem,titulo,severidade)
         VALUES ($1,$2,'IA','Primeira','ALTA')`,
        [obra, det],
      );
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,deteccao_id,origem,titulo,severidade)
           VALUES ($1,$2,'IA','Segunda','BAIXA')`,
          [obra, det],
        ),
      ).toBe('23505');
    });

    it('congela o codigo depois de emitido (ele vai para relatorio impresso)', async () => {
      const nc = await ncDeDeteccao();
      expect(
        await codigoDoErro(`UPDATE nao_conformidade SET codigo='NC-FALSO' WHERE id=$1`, [nc.id]),
      ).toBe('0A000');
    });

    it('exige fechada_em em estado terminal e proibe nos demais', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO nao_conformidade (obra_id,origem,titulo,severidade,status)
           VALUES ($1,'MANUAL','X','ALTA','RESOLVIDA')`,
          [obra],
        ),
      ).toBe('23514');

      const nc = await ncDeDeteccao();
      expect(
        await codigoDoErro(`UPDATE nao_conformidade SET fechada_em=now() WHERE id=$1`, [nc.id]),
      ).toBe('23514');
    });
  });

  describe('acao corretiva', () => {
    it('permite apenas uma acao em aberto por NC', async () => {
      const nc = await ncDeDeteccao();
      await db.query(
        `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
         VALUES ($1,$2,'Refazer impermeabilizacao')`,
        [nc.id, engenheiroA],
      );
      expect(
        await codigoDoErro(
          `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
           VALUES ($1,$2,'Outra')`,
          [nc.id, engenheiroB],
        ),
      ).toBe('23505');
    });

    it('libera nova acao depois que a anterior e concluida (caminho da reprovacao)', async () => {
      const nc = await ncDeDeteccao();
      const { id } = await um(
        `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
         VALUES ($1,$2,'Primeira tentativa') RETURNING id`,
        [nc.id, engenheiroA],
      );
      await db.query(`UPDATE acao_corretiva SET concluida_em=now() WHERE id=$1`, [id]);

      const segunda = await um(
        `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
         VALUES ($1,$2,'Retrabalho apos reprovacao') RETURNING id`,
        [nc.id, engenheiroA],
      );
      expect(segunda.id).toBeTruthy();
    });

    it('recusa conclusao anterior ao inicio e custo negativo', async () => {
      const nc = await ncDeDeteccao();
      const { id } = await um(
        `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
         VALUES ($1,$2,'X') RETURNING id`,
        [nc.id, engenheiroA],
      );
      expect(
        await codigoDoErro(
          `UPDATE acao_corretiva SET concluida_em = iniciada_em - interval '1 hour' WHERE id=$1`,
          [id],
        ),
      ).toBe('23514');
      expect(await codigoDoErro(`UPDATE acao_corretiva SET custo=-1 WHERE id=$1`, [id])).toBe(
        '23514',
      );
    });
  });

  describe('segregacao de funcao', () => {
    async function acaoDoEngenheiroA(): Promise<string> {
      const nc = await ncDeDeteccao();
      const { id } = await um(
        `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao)
         VALUES ($1,$2,'Refazer impermeabilizacao') RETURNING id`,
        [nc.id, engenheiroA],
      );
      return id;
    }

    it('IMPEDE que o executor verifique a propria acao', async () => {
      const acao = await acaoDoEngenheiroA();
      expect(
        await codigoDoErro(
          `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado)
           VALUES ($1,$2,'APROVADA')`,
          [acao, engenheiroA],
        ),
      ).toBe('23514');
    });

    it('aceita a verificacao de outro engenheiro', async () => {
      const acao = await acaoDoEngenheiroA();
      const { id } = await um(
        `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado,parecer)
         VALUES ($1,$2,'APROVADA','Conforme') RETURNING id`,
        [acao, engenheiroB],
      );
      expect(id).toBeTruthy();
    });

    it('permite no maximo uma aprovacao, mantendo reprovacoes no historico', async () => {
      const acao = await acaoDoEngenheiroA();
      await db.query(
        `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado,parecer)
         VALUES ($1,$2,'REPROVADA','Refazer o rodape')`,
        [acao, engenheiroB],
      );
      await db.query(
        `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado,parecer)
         VALUES ($1,$2,'APROVADA','Agora sim')`,
        [acao, engenheiroB],
      );
      expect(
        await codigoDoErro(
          `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado)
           VALUES ($1,$2,'APROVADA')`,
          [acao, engenheiroB],
        ),
      ).toBe('23505');

      const linhas = await db.query(`SELECT id FROM verificacao WHERE acao_corretiva_id=$1`, [acao]);
      expect(linhas).toHaveLength(2);
    });

    it('trata a verificacao como laudo assinado: sem UPDATE, sem DELETE', async () => {
      const acao = await acaoDoEngenheiroA();
      const { id } = await um(
        `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado,parecer)
         VALUES ($1,$2,'APROVADA','Conforme') RETURNING id`,
        [acao, engenheiroB],
      );
      expect(await codigoDoErro(`UPDATE verificacao SET parecer='outro' WHERE id=$1`, [id])).toBe(
        '0A000',
      );
      expect(await codigoDoErro(`DELETE FROM verificacao WHERE id=$1`, [id])).toBe('0A000');
    });
  });

  describe('cadeia de custodia da evidencia', () => {
    it('recusa evidencia orfa', async () => {
      expect(
        await codigoDoErro(
          `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id)
           VALUES ('FOTO','x',$1,'MANUAL',$2)`,
          [HASH_VALIDO, engenheiroA],
        ),
      ).toBe('23514');
    });

    it('exige autor humano na evidencia MANUAL e proibe na de origem IA', async () => {
      const nc = await ncDeDeteccao();
      expect(
        await codigoDoErro(
          `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,nao_conformidade_id)
           VALUES ('FOTO','x',$1,'MANUAL',$2)`,
          [HASH_VALIDO, nc.id],
        ),
      ).toBe('23514');
      expect(
        await codigoDoErro(
          `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,nao_conformidade_id)
           VALUES ('FOTO','x',$1,'IA',$2,$3)`,
          [HASH_VALIDO, engenheiroA, nc.id],
        ),
      ).toBe('23514');
    });

    it('recusa hash fora do formato sha-256', async () => {
      const nc = await ncDeDeteccao();
      expect(
        await codigoDoErro(
          `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,nao_conformidade_id)
           VALUES ('FOTO','x',$1,'MANUAL',$2,$3)`,
          [`Z${'a'.repeat(63)}`, engenheiroA, nc.id],
        ),
      ).toBe('23514');
    });

    it('congela a evidencia depois de gravada: sem UPDATE, sem DELETE', async () => {
      const nc = await ncDeDeteccao();
      const { id } = await um(
        `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,nao_conformidade_id,tamanho_bytes,mime)
         VALUES ('FOTO','evidencias/aa/aa/a.jpg',$1,'MANUAL',$2,$3,12345,'image/jpeg') RETURNING id`,
        [HASH_VALIDO, engenheiroA, nc.id],
      );
      expect(await codigoDoErro(`UPDATE evidencia SET uri='outro' WHERE id=$1`, [id])).toBe('0A000');
      expect(await codigoDoErro(`DELETE FROM evidencia WHERE id=$1`, [id])).toBe('0A000');
    });

    // 23001 (restrict_violation), e nao 23503: o Postgres tem um SQLSTATE
    // proprio para ON DELETE RESTRICT.
    it('impede apagar NC que sustenta prova (FK RESTRICT)', async () => {
      const nc = await ncDeDeteccao();
      await db.query(
        `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,nao_conformidade_id)
         VALUES ('FOTO','x',$1,'MANUAL',$2,$3)`,
        [HASH_VALIDO, engenheiroA, nc.id],
      );
      expect(await codigoDoErro(`DELETE FROM nao_conformidade WHERE id=$1`, [nc.id])).toBe('23001');
    });
  });
});
