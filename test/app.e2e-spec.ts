import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
// 'supertest/types' NAO resolve sob ESM: o subpath so existe em modo CJS
// (o pacote nao tem campo "exports" e nao ha types.js real). Use o tipo do Node.
import type { Server } from 'node:http';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';

describe('Aplicacao (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication();
    // Mesma configuracao do main.ts — o teste exercita a aplicacao real.
    configurarApp(app);
    await app.init();
    finalizarApp(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /health', () => {
    it('responde 200 com o status do processo, fora do prefixo de versao', async () => {
      const resposta = await request(app.getHttpServer()).get('/health').expect(200);

      expect(resposta.body).toMatchObject({ status: 'ok', app: 'perceptra' });
      expect(resposta.body.uptimeSegundos).toBeGreaterThanOrEqual(0);
    });

    it('devolve um x-request-id na resposta', async () => {
      const resposta = await request(app.getHttpServer()).get('/health').expect(200);

      expect(resposta.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    });

    it('ecoa o x-request-id enviado pelo cliente, para correlacionar log', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/health')
        .set('x-request-id', 'rastro-de-teste')
        .expect(200);

      expect(resposta.headers['x-request-id']).toBe('rastro-de-teste');
    });
  });

  describe('contrato de erro', () => {
    it('rota inexistente devolve o envelope padrao, nao o 404 cru do Nest', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/api/v1/rota-que-nao-existe')
        .expect(404);

      expect(resposta.body.erro).toMatchObject({ codigo: 'RECURSO_NAO_ENCONTRADO' });
      // Regressao: o request-id e middleware, nao interceptor — interceptor
      // nao roda em rota que nao casou, e o 404 sairia sem rastro.
      expect(resposta.body.erro.requestId).toMatch(/[0-9a-f-]{36}/);
      expect(resposta.body.erro.caminho).toBe('/api/v1/rota-que-nao-existe');
      expect(typeof resposta.body.erro.timestamp).toBe('string');
    });
  });
});
