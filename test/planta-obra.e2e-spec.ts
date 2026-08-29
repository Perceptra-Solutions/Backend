import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * Planta / mapa da obra: upload, metadado e download, contra Postgres real.
 *
 * O que este arquivo protege: o arquivo tem que ir para o **storage** e o
 * banco guardar só a chave e o hash — não o binário. E a planta, ao
 * contrário da evidência, é substituível: subir outra troca a vigente.
 */
describe('Planta da obra (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let ds: DataSource;

  let tokenGestora: string;
  let tokenAna: string;
  let obraId: string;

  /** PNG 1x1 válido. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  /** Um segundo arquivo, diferente do primeiro, para testar a substituição. */
  const PNG_OUTRO = Buffer.concat([PNG, Buffer.from('perceptra')]);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  const login = async (email: string): Promise<string> => {
    const { body } = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, senha: SENHA_PADRAO_SEED })
      .expect(200);
    return body.acessoToken;
  };

  const enviarPlanta = (arquivo: Buffer, nome: string, mime: string, token = tokenGestora) =>
    request(http)
      .post(`/api/v1/obras/${obraId}/planta`)
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', arquivo, { filename: nome, contentType: mime });

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

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

    [tokenGestora, tokenAna] = await Promise.all([
      login('gestora@perceptra.dev'),
      login('ana@perceptra.dev'),
    ]);

    const [obra] = await ds.query(`SELECT id FROM obra ORDER BY criado_em ASC LIMIT 1`);
    obraId = obra.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('estado vazio', () => {
    it('obra sem planta responde existe:false, não 404', async () => {
      const { body } = await request(http)
        .get(`/api/v1/obras/${obraId}/planta`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(body).toMatchObject({ existe: false, nome: null, mime: null, hashSha256: null });
    });

    it('baixar a planta inexistente devolve 404', async () => {
      await request(http)
        .get(`/api/v1/obras/${obraId}/planta/arquivo`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(404);
    });
  });

  describe('upload', () => {
    it('GESTOR envia a planta e o metadado volta preenchido', async () => {
      const { body } = await enviarPlanta(PNG, 'planta-terreo.png', 'image/png').expect(201);

      expect(body).toMatchObject({
        existe: true,
        nome: 'planta-terreo.png',
        mime: 'image/png',
        hashSha256: sha(PNG),
      });
      expect(Number(body.tamanhoBytes)).toBe(PNG.length);
      expect(body.atualizadaEm).toBeTruthy();
    });

    it('ENGENHEIRO não envia planta — é cadastro, ato de gestão', async () => {
      await enviarPlanta(PNG, 'x.png', 'image/png', tokenAna).expect(403);
    });

    it('recusa formato que a tela não saberia exibir', async () => {
      const { body } = await enviarPlanta(Buffer.from('nao sou imagem'), 'planta.txt', 'text/plain').expect(422);
      expect(body.erro.codigo).toBe('MIME_NAO_PERMITIDO');
    });

    it('recusa requisição sem arquivo', async () => {
      const { body } = await request(http)
        .post(`/api/v1/obras/${obraId}/planta`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(422);
      expect(body.erro.codigo).toBe('ARQUIVO_OBRIGATORIO');
    });

    it('404 em obra inexistente', async () => {
      await request(http)
        .post('/api/v1/obras/00000000-0000-4000-8000-000000000000/planta')
        .set('Authorization', `Bearer ${tokenGestora}`)
        .attach('arquivo', PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(404);
    });
  });

  describe('download', () => {
    it('devolve o arquivo byte a byte idêntico ao enviado', async () => {
      const resposta = await request(http)
        .get(`/api/v1/obras/${obraId}/planta/arquivo`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(resposta.headers['content-type']).toContain('image/png');
      expect(sha(resposta.body)).toBe(sha(PNG));
    });

    it('exige autenticação', async () => {
      await request(http).get(`/api/v1/obras/${obraId}/planta/arquivo`).expect(401);
    });
  });

  describe('armazenamento', () => {
    /**
     * O binário fica no storage; o banco guarda só a chave endereçada por
     * conteúdo. Se um dia alguém gravar o arquivo numa coluna, este teste
     * quebra — que é o ponto.
     */
    it('o banco guarda a chave do storage, não o arquivo', async () => {
      const [linha] = await ds.query(
        `SELECT planta_uri, planta_hash_sha256, planta_tamanho_bytes FROM obra WHERE id=$1`,
        [obraId],
      );

      expect(linha.planta_uri).toMatch(/^plantas\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
      expect(linha.planta_hash_sha256).toBe(sha(PNG));
      expect(Number(linha.planta_tamanho_bytes)).toBe(PNG.length);
    });

    it('a listagem de obras nunca expõe o caminho interno do storage', async () => {
      const { body } = await request(http)
        .get('/api/v1/obras')
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(JSON.stringify(body)).not.toContain('plantas/');
      expect(body.itens[0]).not.toHaveProperty('plantaUri');
    });
  });

  describe('substituição', () => {
    // Planta é cadastro, não prova: subir outra troca a vigente, sem
    // versionamento. É o oposto da evidência, que o banco congela.
    it('enviar outra planta substitui a anterior', async () => {
      const { body } = await enviarPlanta(PNG_OUTRO, 'planta-revisada.png', 'image/png').expect(201);

      expect(body.nome).toBe('planta-revisada.png');
      expect(body.hashSha256).toBe(sha(PNG_OUTRO));
      expect(body.hashSha256).not.toBe(sha(PNG));

      const resposta = await request(http)
        .get(`/api/v1/obras/${obraId}/planta/arquivo`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);
      expect(sha(resposta.body)).toBe(sha(PNG_OUTRO));
    });

    it('subir o MESMO arquivo de novo converge para a mesma chave', async () => {
      const { body: primeira } = await enviarPlanta(PNG_OUTRO, 'copia.png', 'image/png').expect(201);
      const [linha] = await ds.query(`SELECT planta_uri FROM obra WHERE id=$1`, [obraId]);

      // Chave endereçada por conteúdo: mesmo binário, mesma chave — o nome
      // do arquivo muda no metadado, o objeto no storage não duplica.
      expect(linha.planta_uri).toContain(sha(PNG_OUTRO));
      expect(primeira.nome).toBe('copia.png');
    });
  });

  describe('invariante do schema', () => {
    /**
     * `ck_obra_planta_completa`: ou todos os campos da planta estão
     * preenchidos, ou nenhum. Uma gravação pela metade deixaria o download
     * apontando para arquivo sem hash para conferir.
     */
    it('o banco recusa planta gravada pela metade', async () => {
      await expect(
        ds.query(`UPDATE obra SET planta_uri='plantas/xx/yy/zz.png', planta_hash_sha256=NULL WHERE id=$1`, [
          obraId,
        ]),
      ).rejects.toThrow();
    });

    it('o banco recusa hash fora do formato sha-256', async () => {
      await expect(
        ds.query(`UPDATE obra SET planta_hash_sha256=$1 WHERE id=$2`, [`Z${'a'.repeat(63)}`, obraId]),
      ).rejects.toThrow();
    });
  });
});
