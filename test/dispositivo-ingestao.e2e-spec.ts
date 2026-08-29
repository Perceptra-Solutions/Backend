import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * A borda: credencial de dispositivo, ingestao em lote e heartbeat.
 *
 * Por que este arquivo existe: `dispositivo-sql.spec.ts` ja cobre a SQL crua
 * contra as migrations (o ON CONFLICT descarta a repetida), e mesmo assim a
 * API respondia `duplicadas: 0` para um lote inteiramente duplicado. O erro
 * nao estava na SQL — estava na leitura do resultado do TypeORM, que so o
 * caminho real (QueryBuilder contra Postgres de verdade) revela. Um teste de
 * SQL crua NUNCA pegaria isso.
 */
describe('Dispositivo — credencial, ingestao e heartbeat (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let ds: DataSource;

  let tokenGestora: string;
  let cameraId: string;
  let modeloId: string;
  let limiarDoModelo: number;

  /** `Authorization: pcr_...` cru — o guard aceita com e sem "Bearer". */
  let chave: string;

  const agora = () => new Date().toISOString();

  function item(sobrescreve: Record<string, unknown> = {}) {
    return {
      modeloIaId: modeloId,
      classe: 'TRINCA',
      confianca: 0.95,
      bbox: { x: 1, y: 2, w: 30, h: 40 },
      ocorridoEm: agora(),
      ...sobrescreve,
    };
  }

  const ingerir = (deteccoes: Record<string, unknown>[]) =>
    request(http).post('/api/v1/dispositivo/deteccoes').set('Authorization', chave).send({ deteccoes });

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication();
    configurarApp(app);
    await app.init();
    finalizarApp(app);
    http = app.getHttpServer();

    ds = app.get(DataSource);
    await ds.query(`TRUNCATE nao_conformidade_evento, evidencia, verificacao, acao_corretiva,
      nao_conformidade, deteccao, credencial_dispositivo, camera, local, requisito_norma,
      modelo_ia, obra, usuario, relatorio_item, relatorio RESTART IDENTITY CASCADE`);
    await ds.query(`ALTER SEQUENCE seq_nc_codigo RESTART WITH 1`);
    await semear((sql, params) => ds.query(sql, params as never[]));

    const { body: login } = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'gestora@perceptra.dev', senha: SENHA_PADRAO_SEED })
      .expect(200);
    tokenGestora = login.acessoToken;

    const { body: cameras } = await request(http)
      .get('/api/v1/cameras?tamanho=1')
      .set('Authorization', `Bearer ${tokenGestora}`)
      .expect(200);
    cameraId = cameras.itens[0].id;

    const [modelo] = await ds.query(
      `SELECT id, limiar_confianca FROM modelo_ia WHERE nome='trinca-detector' ORDER BY versao DESC LIMIT 1`,
    );
    modeloId = modelo.id;
    limiarDoModelo = Number(modelo.limiar_confianca);

    const { body: credencial } = await request(http)
      .post(`/api/v1/cameras/${cameraId}/credenciais`)
      .set('Authorization', `Bearer ${tokenGestora}`)
      .send({ escopos: ['deteccao:ingerir', 'heartbeat:enviar'] })
      .expect(201);
    chave = credencial.chave;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('credencial', () => {
    it('devolve a chave uma unica vez, no formato pcr_<prefixo>_<segredo>', () => {
      expect(chave).toMatch(/^pcr_[0-9a-f]{12}_[A-Za-z0-9_-]+$/);
    });

    it('guarda so o hash — a chave em claro nunca vai para o banco', async () => {
      const [linha] = await ds.query(
        `SELECT hash_secreto FROM credencial_dispositivo WHERE camera_id=$1`,
        [cameraId],
      );
      expect(linha.hash_secreto).toMatch(/^[0-9a-f]{64}$/);
      expect(chave).not.toContain(linha.hash_secreto);
    });

    it('recusa a ingestao sem credencial', async () => {
      const { body } = await request(http)
        .post('/api/v1/dispositivo/deteccoes')
        .send({ deteccoes: [item()] })
        .expect(401);
      expect(body.erro.codigo).toBe('NAO_AUTENTICADO');
    });

    it('recusa uma chave com o segredo trocado, mesmo com o prefixo certo', async () => {
      const prefixo = chave.split('_')[1];
      await request(http)
        .post('/api/v1/dispositivo/deteccoes')
        .set('Authorization', `pcr_${prefixo}_segredoErradoMasComTamanhoParecido123`)
        .send({ deteccoes: [item()] })
        .expect(401);
    });
  });

  describe('ingestao em lote', () => {
    it('aceita um lote novo e grava obra_id pelo trigger, sem o cliente informar', async () => {
      const idExterno = `lote-novo-${Date.now()}`;
      const { body } = await ingerir([item({ idExterno })]).expect(201);

      expect(body).toMatchObject({ aceitas: 1, duplicadas: 0, descartadasPorLimiar: 0, rejeitadas: [] });

      const [gravada] = await ds.query(`SELECT obra_id FROM deteccao WHERE id_externo=$1`, [idExterno]);
      const [camera] = await ds.query(`SELECT obra_id FROM camera WHERE id=$1`, [cameraId]);
      expect(gravada.obra_id).toBe(camera.obra_id);
    });

    // O bug que motivou este arquivo. Antes da correcao esta asercao falhava
    // com `aceitas: 1, duplicadas: 0` — o banco descartava certo, mas a
    // resposta dizia que tinha gravado.
    it('conta a reentrega do mesmo idExterno como duplicada, nao como aceita', async () => {
      const idExterno = `dedup-${Date.now()}`;

      const { body: primeira } = await ingerir([item({ idExterno })]).expect(201);
      expect(primeira).toMatchObject({ aceitas: 1, duplicadas: 0 });

      const { body: segunda } = await ingerir([item({ idExterno })]).expect(201);
      expect(segunda).toMatchObject({ aceitas: 0, duplicadas: 1 });

      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM deteccao WHERE id_externo=$1`,
        [idExterno],
      );
      expect(count).toBe(1);
    });

    it('num lote misto, conta separadamente o que entrou e o que ja existia', async () => {
      const jaExiste = `misto-antigo-${Date.now()}`;
      await ingerir([item({ idExterno: jaExiste })]).expect(201);

      const { body } = await ingerir([
        item({ idExterno: jaExiste }),
        item({ idExterno: `misto-novo-a-${Date.now()}` }),
        item({ idExterno: `misto-novo-b-${Date.now()}` }),
      ]).expect(201);

      expect(body).toMatchObject({ aceitas: 2, duplicadas: 1, rejeitadas: [] });
    });

    it('itens sem idExterno nunca sao contados como duplicados entre si', async () => {
      const { body } = await ingerir([item(), item(), item()]).expect(201);
      expect(body).toMatchObject({ aceitas: 3, duplicadas: 0 });
    });

    it('descarta em silencio quem esta abaixo do limiar do modelo', async () => {
      const { body } = await ingerir([
        item({ idExterno: `fraca-${Date.now()}`, confianca: Math.max(limiarDoModelo - 0.2, 0.01) }),
      ]).expect(201);

      expect(body).toMatchObject({ aceitas: 0, duplicadas: 0, descartadasPorLimiar: 1, rejeitadas: [] });
    });

    it('rejeita com motivo quem ocorreu fora da janela aceitavel', async () => {
      const { body } = await ingerir([
        item({ idExterno: `velha-${Date.now()}`, ocorridoEm: '2020-01-01T00:00:00.000Z' }),
      ]).expect(201);

      expect(body.aceitas).toBe(0);
      expect(body.rejeitadas).toHaveLength(1);
      expect(body.rejeitadas[0].motivo).toBe('OCORRIDO_EM_FORA_DA_JANELA');
    });

    it('rejeita item cujo modelo nao existe, sem derrubar o resto do lote', async () => {
      const { body } = await ingerir([
        item({ idExterno: `orfa-${Date.now()}`, modeloIaId: '00000000-0000-4000-8000-000000000000' }),
        item({ idExterno: `boa-${Date.now()}` }),
      ]).expect(201);

      expect(body.aceitas).toBe(1);
      expect(body.rejeitadas).toHaveLength(1);
      expect(body.rejeitadas[0].motivo).toBe('MODELO_NAO_ENCONTRADO');
    });

    // 422, nao 400: o contrato de erro do projeto usa UNPROCESSABLE_ENTITY
    // para falha de validacao (ver criarValidationPipe).
    it('recusa lote vazio e lote acima de 100 itens', async () => {
      const { body: vazio } = await ingerir([]).expect(422);
      expect(vazio.erro.codigo).toBe('VALIDACAO_FALHOU');

      await ingerir(Array.from({ length: 101 }, () => item())).expect(422);
    });
  });

  describe('heartbeat', () => {
    it('acorda a camera que estava OFFLINE e grava o timestamp', async () => {
      await ds.query(`UPDATE camera SET status='OFFLINE', ultimo_heartbeat=NULL WHERE id=$1`, [cameraId]);

      await request(http)
        .post('/api/v1/dispositivo/heartbeat')
        .set('Authorization', chave)
        .send({})
        .expect(200);

      const [camera] = await ds.query(`SELECT status, ultimo_heartbeat FROM camera WHERE id=$1`, [cameraId]);
      expect(camera.status).toBe('ATIVA');
      expect(camera.ultimo_heartbeat).toBeTruthy();
    });

    it('nao tira da MANUTENCAO — so quem estava OFFLINE volta sozinho', async () => {
      await ds.query(`UPDATE camera SET status='MANUTENCAO' WHERE id=$1`, [cameraId]);

      await request(http)
        .post('/api/v1/dispositivo/heartbeat')
        .set('Authorization', chave)
        .send({})
        .expect(200);

      const [camera] = await ds.query(`SELECT status FROM camera WHERE id=$1`, [cameraId]);
      expect(camera.status).toBe('MANUTENCAO');

      await ds.query(`UPDATE camera SET status='ATIVA' WHERE id=$1`, [cameraId]);
    });
  });

  describe('revogacao', () => {
    it('uma credencial revogada para de autenticar na hora seguinte ao cache', async () => {
      const { body: nova } = await request(http)
        .post(`/api/v1/cameras/${cameraId}/credenciais`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .send({ escopos: ['heartbeat:enviar'] })
        .expect(201);

      await request(http)
        .post('/api/v1/dispositivo/heartbeat')
        .set('Authorization', nova.chave)
        .send({})
        .expect(200);

      await request(http)
        .post(`/api/v1/cameras/${cameraId}/credenciais/${nova.id}/revogacao`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      const [linha] = await ds.query(`SELECT revogada_em FROM credencial_dispositivo WHERE id=$1`, [nova.id]);
      expect(linha.revogada_em).toBeTruthy();
    });

    it('a credencial de heartbeat nao consegue ingerir deteccao (escopo separado)', async () => {
      const { body: soHeartbeat } = await request(http)
        .post(`/api/v1/cameras/${cameraId}/credenciais`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .send({ escopos: ['heartbeat:enviar'] })
        .expect(201);

      await request(http)
        .post('/api/v1/dispositivo/deteccoes')
        .set('Authorization', soHeartbeat.chave)
        .send({ deteccoes: [item()] })
        .expect(403);
    });
  });
});
