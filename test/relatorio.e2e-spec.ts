import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * O relatorio como artefato de auditoria: snapshot congelado, arquivo
 * armazenado e hash conferivel.
 *
 * O que estes testes protegem, e que um teste de unidade nao alcanca: que a
 * ordem impressa no documento e a MESMA que foi persistida em
 * `relatorio_item.ordem`, e que o hash gravado corresponde ao arquivo que
 * sai pelo download. Se essas duas coisas divergirem, o relatorio deixa de
 * provar o que diz provar.
 */
describe('Relatorios (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let ds: DataSource;

  let tokenGestora: string;
  let tokenAna: string;
  let obraId: string;

  const login = async (email: string): Promise<string> => {
    const { body } = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, senha: SENHA_PADRAO_SEED })
      .expect(200);
    return body.acessoToken;
  };

  const gerar = (corpo: Record<string, unknown>, token = tokenGestora) =>
    request(http).post('/api/v1/relatorios').set('Authorization', `Bearer ${token}`).send(corpo);

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

  describe('geracao', () => {
    it('gera o relatorio da obra e congela as NCs como itens ordenados', async () => {
      const { body } = await gerar({ obraId, tipo: 'OBRA' }).expect(201);

      expect(body.id).toBeTruthy();
      expect(body.totalItens).toBeGreaterThan(0);
      expect(body.hashSha256).toMatch(/^[0-9a-f]{64}$/);

      const itens = await ds.query(
        `SELECT ordem FROM relatorio_item WHERE relatorio_id=$1 ORDER BY ordem`,
        [body.id],
      );
      // Ordem contigua comecando em 1 — e o que o CHECK ck_relatorio_item_ordem
      // e o indice unico (relatorio_id, ordem) esperam.
      expect(itens.map((i: { ordem: number }) => i.ordem)).toEqual(
        Array.from({ length: itens.length }, (_, i) => i + 1),
      );
    });

    it('a ordem persistida reproduz a ordem impressa no documento', async () => {
      const { body } = await gerar({ obraId, tipo: 'OBRA' }).expect(201);

      const { body: detalhe } = await request(http)
        .get(`/api/v1/relatorios/${body.id}`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      const documento = await request(http)
        .get(`/api/v1/relatorios/${body.id}/arquivo`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      // Cada codigo aparece no HTML na mesma sequencia da tabela de itens.
      const posicoes = detalhe.itens.map((i: { codigo: string }) => documento.text.indexOf(i.codigo));
      expect(posicoes.every((p: number) => p >= 0)).toBe(true);
      expect([...posicoes].sort((a: number, b: number) => a - b)).toEqual(posicoes);
    });

    it('poe a severidade mais grave primeiro', async () => {
      const { body } = await gerar({ obraId, tipo: 'OBRA' }).expect(201);
      const { body: detalhe } = await request(http)
        .get(`/api/v1/relatorios/${body.id}`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      const peso: Record<string, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };
      const pesos = detalhe.itens.map((i: { severidade: string }) => peso[i.severidade]);
      expect([...pesos].sort((a: number, b: number) => a - b)).toEqual(pesos);
    });

    it('filtra por severidade, e o snapshot guarda so o que foi filtrado', async () => {
      const { body } = await gerar({ obraId, tipo: 'OBRA', severidades: ['CRITICA'] }).expect(201);

      const { body: detalhe } = await request(http)
        .get(`/api/v1/relatorios/${body.id}`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(detalhe.itens.length).toBeGreaterThan(0);
      expect(detalhe.itens.every((i: { severidade: string }) => i.severidade === 'CRITICA')).toBe(true);
    });

    it('exige periodo quando o tipo e PERIODICO', async () => {
      const { body } = await gerar({ obraId, tipo: 'PERIODICO' }).expect(422);
      expect(body.erro.codigo).toBe('VALIDACAO_FALHOU');
    });

    it('aceita PERIODICO com periodo e grava as duas datas', async () => {
      const { body } = await gerar({
        obraId,
        tipo: 'PERIODICO',
        periodoInicio: '2020-01-01',
        periodoFim: '2030-12-31',
      }).expect(201);

      expect(body.periodoInicio).toBe('2020-01-01');
      expect(body.periodoFim).toBe('2030-12-31');
      expect(body.totalItens).toBeGreaterThan(0);
    });

    it('recusa periodo invertido com erro de negocio, nao 500 do banco', async () => {
      const { body } = await gerar({
        obraId,
        tipo: 'PERIODICO',
        periodoInicio: '2030-12-31',
        periodoFim: '2020-01-01',
      }).expect(422);

      expect(body.erro.codigo).toBe('PERIODO_INVERTIDO');
    });

    it('um periodo sem NC nenhuma gera relatorio vazio, mas valido', async () => {
      const { body } = await gerar({
        obraId,
        tipo: 'PERIODICO',
        periodoInicio: '1999-01-01',
        periodoFim: '1999-12-31',
      }).expect(201);

      expect(body.totalItens).toBe(0);
      expect(body.hashSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('recusa relatorio de NC sem nenhuma NC — nao ha o que atestar', async () => {
      const { body } = await gerar({
        obraId,
        tipo: 'NAO_CONFORMIDADE',
        periodoInicio: '1999-01-01',
        periodoFim: '1999-12-31',
      }).expect(422);

      expect(body.erro.codigo).toBe('RELATORIO_SEM_ITENS');
    });

    it('404 para obra inexistente', async () => {
      await gerar({ obraId: '00000000-0000-4000-8000-000000000000', tipo: 'OBRA' }).expect(404);
    });

    it('so GESTOR emite; ENGENHEIRO recebe 403', async () => {
      await gerar({ obraId, tipo: 'OBRA' }, tokenAna).expect(403);
    });

    it('ENGENHEIRO continua podendo ler o que foi emitido', async () => {
      await request(http)
        .get('/api/v1/relatorios')
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);
    });
  });

  describe('arquivo e integridade', () => {
    let relatorioId: string;
    let hash: string;

    beforeAll(async () => {
      const { body } = await gerar({ obraId, tipo: 'OBRA' }).expect(201);
      relatorioId = body.id;
      hash = body.hashSha256;
    });

    it('baixa o documento como HTML autocontido', async () => {
      const resposta = await request(http)
        .get(`/api/v1/relatorios/${relatorioId}/arquivo`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(resposta.headers['content-type']).toContain('text/html');
      expect(resposta.text).toContain('<!doctype html>');
      expect(resposta.text).toContain('Residencial Aurora');
    });

    it('o hash gravado corresponde ao arquivo que sai pelo download', async () => {
      const { body } = await request(http)
        .get(`/api/v1/relatorios/${relatorioId}/integridade`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(body).toMatchObject({ integra: true, hashArmazenado: hash, hashRecalculado: hash });
    });

    it('404 em relatorio inexistente', async () => {
      await request(http)
        .get('/api/v1/relatorios/00000000-0000-4000-8000-000000000000/integridade')
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(404);
    });
  });

  describe('determinismo', () => {
    // O documento e hasheado e enderecado por conteudo: duas geracoes do
    // mesmo recorte, com o mesmo titulo, tem que produzir o MESMO arquivo.
    // Se isso quebrar, cada re-emissao vira um objeto novo no storage e o
    // hash deixa de ser prova de conteudo.
    it('duas geracoes do mesmo recorte produzem o mesmo documento', async () => {
      const corpo = { obraId, tipo: 'OBRA', titulo: 'Titulo fixo para o teste' };

      const { body: primeira } = await gerar(corpo).expect(201);
      const { body: segunda } = await gerar(corpo).expect(201);

      const a = await request(http)
        .get(`/api/v1/relatorios/${primeira.id}/arquivo`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);
      const b = await request(http)
        .get(`/api/v1/relatorios/${segunda.id}/arquivo`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      // O unico campo que muda entre as duas e "Gerado em" — removido antes
      // de comparar, porque o resto do documento e que precisa ser estavel.
      const semData = (html: string) => html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/g, 'DATA');
      expect(semData(a.text)).toBe(semData(b.text));
    });
  });

  describe('listagem', () => {
    it('lista com paginacao e filtro por obra', async () => {
      const { body } = await request(http)
        .get(`/api/v1/relatorios?obraId=${obraId}&tamanho=5`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(body.itens.length).toBeGreaterThan(0);
      expect(body.itens.length).toBeLessThanOrEqual(5);
      expect(body.itens.every((r: { obraId: string }) => r.obraId === obraId)).toBe(true);
    });

    // `totalItens` na listagem vem de um GROUP BY separado (uma consulta para
    // a pagina inteira, em vez de N COUNT num laco). Se aquele agrupamento
    // errar a juncao, o campo volta 0 para tudo sem erro nenhum — por isso a
    // asercao confere contra a contagem real, nao so o tipo do valor.
    it('totalItens da listagem bate com os itens gravados', async () => {
      const { body } = await request(http)
        .get(`/api/v1/relatorios?obraId=${obraId}&tamanho=20`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      for (const relatorio of body.itens as { id: string; totalItens: number }[]) {
        const [{ count }] = await ds.query(
          `SELECT count(*)::int AS count FROM relatorio_item WHERE relatorio_id=$1`,
          [relatorio.id],
        );
        expect(relatorio.totalItens).toBe(count);
      }

      // Pelo menos um relatorio da suite tem itens — senao a asercao acima
      // passaria comparando zero com zero.
      expect(body.itens.some((r: { totalItens: number }) => r.totalItens > 0)).toBe(true);
    });

    it('filtra por tipo', async () => {
      const { body } = await request(http)
        .get('/api/v1/relatorios?tipo=PERIODICO')
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(body.itens.every((r: { tipo: string }) => r.tipo === 'PERIODICO')).toBe(true);
    });

    it('nao expoe arquivoUri — caminho interno do storage nao vaza na API', async () => {
      const { body } = await request(http)
        .get('/api/v1/relatorios?tamanho=1')
        .set('Authorization', `Bearer ${tokenGestora}`)
        .expect(200);

      expect(body.itens[0]).not.toHaveProperty('arquivoUri');
    });
  });
});
