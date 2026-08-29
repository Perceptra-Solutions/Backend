import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * O ciclo inteiro, contra a aplicacao real e um Postgres real.
 *
 * Este teste existe para uma coisa: garantir que a segregacao de funcao e a
 * maquina de estados continuem valendo pela API — nao so no dominio puro e
 * no banco, que ja tem testes proprios.
 */
describe('Ciclo da qualidade (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;

  let tokenAna: string;
  let tokenBruno: string;
  let tokenGestora: string;
  let idAna: string;
  let requisitoId: string;

  const login = async (email: string): Promise<string> => {
    const { body } = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, senha: SENHA_PADRAO_SEED })
      .expect(200);
    return body.acessoToken;
  };

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication();
    configurarApp(app);
    await app.init();
    finalizarApp(app);
    http = app.getHttpServer();

    // Banco de teste limpo e semeado: a suite precisa de deteccoes pendentes
    // e de DOIS engenheiros para a segregacao de funcao ter sentido.
    const ds = app.get(DataSource);
    await ds.query(`TRUNCATE nao_conformidade_evento, evidencia, verificacao, acao_corretiva,
      nao_conformidade, deteccao, camera, local, requisito_norma, modelo_ia, obra,
      usuario, relatorio_item, relatorio RESTART IDENTITY CASCADE`);
    await ds.query(`ALTER SEQUENCE seq_nc_codigo RESTART WITH 1`);
    await semear((sql, params) => ds.query(sql, params as never[]));

    [tokenAna, tokenBruno, tokenGestora] = await Promise.all([
      login('ana@perceptra.dev'),
      login('bruno@perceptra.dev'),
      login('gestora@perceptra.dev'),
    ]);

    const eu = await request(http)
      .get('/api/v1/auth/eu')
      .set('Authorization', `Bearer ${tokenAna}`);
    idAna = eu.body.id;

    const [{ id }] = await ds.query(
      `SELECT id FROM requisito_norma WHERE categoria='ESTANQUEIDADE' LIMIT 1`,
    );
    requisitoId = id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Pega uma deteccao pendente da fila e devolve seu id. */
  async function deteccaoPendente(): Promise<string> {
    const { body } = await request(http)
      .get('/api/v1/deteccoes?statusTriagem=PENDENTE&tamanho=1')
      .set('Authorization', `Bearer ${tokenAna}`)
      .expect(200);
    return body.itens[0].id;
  }

  async function abrirNc(severidade = 'ALTA') {
    const { body } = await request(http)
      .post(`/api/v1/deteccoes/${await deteccaoPendente()}/nao-conformidades`)
      .set('Authorization', `Bearer ${tokenAna}`)
      .send({
        titulo: 'Infiltracao detectada pela camera',
        severidade,
        requisitoNormaId: requisitoId,
        responsavelId: idAna,
      })
      .expect(201);
    return body;
  }

  async function acaoConcluida(ncId: string): Promise<string> {
    const { body: acao } = await request(http)
      .post(`/api/v1/nao-conformidades/${ncId}/acoes-corretivas`)
      .set('Authorization', `Bearer ${tokenAna}`)
      .send({ executorId: idAna, descricao: 'Reaplicacao de manta asfaltica no rodape' })
      .expect(201);

    await request(http)
      .post(`/api/v1/acoes-corretivas/${acao.id}/conclusao`)
      .set('Authorization', `Bearer ${tokenAna}`)
      .send({ custo: 1800 })
      .expect(200);

    return acao.id;
  }

  describe('abertura a partir de deteccao', () => {
    it('gera codigo e prazo pela severidade, e devolve os dois na resposta', async () => {
      // Regressao: codigo e prazo vem de trigger, e o save() do TypeORM
      // devolve a entidade enviada — sem recarregar, a API respondia
      // codigo undefined numa NC que ja tinha codigo no banco.
      const nc = await abrirNc('ALTA');

      expect(nc.codigo).toMatch(/^NC-\d{4}-\d{6}$/);
      const horas =
        (new Date(nc.prazo).getTime() - new Date(nc.abertaEm).getTime()) / 3_600_000;
      expect(horas).toBe(72);
      expect(nc.status).toBe('ABERTA');
      expect(nc.fechadaEm).toBeNull();
    });

    it('recusa a segunda NC da mesma deteccao, apontando a existente', async () => {
      const det = await deteccaoPendente();
      const payload = { titulo: 'Primeira NC desta deteccao', severidade: 'MEDIA' };

      await request(http)
        .post(`/api/v1/deteccoes/${det}/nao-conformidades`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .send(payload)
        .expect(201);

      const { body } = await request(http)
        .post(`/api/v1/deteccoes/${det}/nao-conformidades`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .send({ ...payload, titulo: 'Duplicada' })
        .expect(409);

      expect(body.erro.codigo).toBe('DETECCAO_JA_TEM_NC');
      expect(body.erro.mensagem).toMatch(/NC-\d{4}-\d{6}/);
    });

    it('impede o GESTOR de triar: triagem e ato tecnico', async () => {
      const { body } = await request(http)
        .post(`/api/v1/deteccoes/${await deteccaoPendente()}/triagem`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .send({ resultado: 'FALSO_POSITIVO' })
        .expect(403);

      expect(body.erro.codigo).toBe('ACESSO_NEGADO');
    });
  });

  describe('segregacao de funcao', () => {
    it('IMPEDE o executor de verificar a propria acao', async () => {
      const nc = await abrirNc();
      const acaoId = await acaoConcluida(nc.id);

      const { body } = await request(http)
        .post(`/api/v1/acoes-corretivas/${acaoId}/verificacoes`)
        .set('Authorization', `Bearer ${tokenAna}`) // Ana executou
        .send({ resultado: 'APROVADA', parecer: 'Ficou bom, eu mesma fiz' })
        .expect(422);

      expect(body.erro.codigo).toBe('SEGREGACAO_FUNCAO_VIOLADA');
    });

    it('aceita a verificacao de outro engenheiro e fecha a NC', async () => {
      const nc = await abrirNc();
      const acaoId = await acaoConcluida(nc.id);

      const { body: verificacao } = await request(http)
        .post(`/api/v1/acoes-corretivas/${acaoId}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'APROVADA', parecer: 'Teste de estanqueidade sem vazamento.' })
        .expect(201);

      const { body: fechada } = await request(http)
        .get(`/api/v1/nao-conformidades/${nc.id}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(fechada.status).toBe('RESOLVIDA');
      // Os dois numeros precisam bater: e o que o relatorio afirma.
      expect(fechada.fechadaEm).toBe(verificacao.verificadoEm);
    });
  });

  describe('caminho da reprovacao', () => {
    it('devolve a NC para EM_CORRECAO sem estender o prazo', async () => {
      const nc = await abrirNc();
      const acaoId = await acaoConcluida(nc.id);

      await request(http)
        .post(`/api/v1/acoes-corretivas/${acaoId}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'REPROVADA', parecer: 'Selante aplicado sem a tela de reforco.' })
        .expect(201);

      const { body: depois } = await request(http)
        .get(`/api/v1/nao-conformidades/${nc.id}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(depois.status).toBe('EM_CORRECAO');
      expect(depois.fechadaEm).toBeNull();
      // A obra nao ganha tempo por ter feito a correcao errada.
      expect(depois.prazo).toBe(nc.prazo);
    });

    it('exige parecer ao reprovar', async () => {
      const nc = await abrirNc();
      const acaoId = await acaoConcluida(nc.id);

      const { body } = await request(http)
        .post(`/api/v1/acoes-corretivas/${acaoId}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'REPROVADA' })
        .expect(422);

      expect(body.erro.codigo).toBe('PARECER_OBRIGATORIO_NA_REPROVACAO');
    });

    it('permite nova acao apos a reprovacao, mantendo a anterior no historico', async () => {
      const nc = await abrirNc();
      const primeira = await acaoConcluida(nc.id);

      await request(http)
        .post(`/api/v1/acoes-corretivas/${primeira}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'REPROVADA', parecer: 'Faltou a tela de reforco especificada.' })
        .expect(201);

      const segunda = await acaoConcluida(nc.id);

      await request(http)
        .post(`/api/v1/acoes-corretivas/${segunda}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'APROVADA', parecer: 'Tela conferida. Conforme.' })
        .expect(201);

      const { body: dossie } = await request(http)
        .get(`/api/v1/nao-conformidades/${nc.id}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(dossie.status).toBe('RESOLVIDA');
      expect(dossie.acoesCorretivas).toHaveLength(2);
      expect(dossie.acoesCorretivas[0].verificacoes[0].resultado).toBe('REPROVADA');
    });
  });

  describe('transicoes invalidas', () => {
    it('recusa verificar acao que ainda nao foi concluida', async () => {
      const nc = await abrirNc();
      const { body: acao } = await request(http)
        .post(`/api/v1/nao-conformidades/${nc.id}/acoes-corretivas`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .send({ executorId: idAna, descricao: 'Acao ainda em andamento no canteiro' })
        .expect(201);

      const { body } = await request(http)
        .post(`/api/v1/acoes-corretivas/${acao.id}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'APROVADA' })
        .expect(422);

      expect(body.erro.codigo).toBe('ACAO_NAO_CONCLUIDA');
    });

    it('recusa duas acoes em aberto na mesma NC', async () => {
      const nc = await abrirNc();
      const criar = () =>
        request(http)
          .post(`/api/v1/nao-conformidades/${nc.id}/acoes-corretivas`)
          .set('Authorization', `Bearer ${tokenAna}`)
          .send({ executorId: idAna, descricao: 'Uma acao corretiva qualquer' });

      await criar().expect(201);
      const { body } = await criar().expect(409);

      expect(body.erro.codigo).toBe('ACAO_CORRETIVA_JA_EM_ABERTO');
    });

    it('bloqueia mass assignment de status no PATCH', async () => {
      const nc = await abrirNc();

      const { body } = await request(http)
        .patch(`/api/v1/nao-conformidades/${nc.id}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .send({ titulo: 'Titulo novo', status: 'RESOLVIDA' })
        .expect(422);

      expect(body.erro.codigo).toBe('VALIDACAO_FALHOU');
      expect(JSON.stringify(body.erro.detalhes)).toContain('status');
    });
  });

  describe('cancelamento', () => {
    it('so o GESTOR cancela, e a deteccao volta a falso positivo', async () => {
      const nc = await abrirNc();

      await request(http)
        .post(`/api/v1/nao-conformidades/${nc.id}/cancelamento`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .send({ motivo: 'Engenheira tentando cancelar sem ser gestora' })
        .expect(403);

      await request(http)
        .post(`/api/v1/nao-conformidades/${nc.id}/cancelamento`)
        .set('Authorization', `Bearer ${tokenGestora}`)
        .send({ motivo: 'Duplicada da NC anterior, aberta pela mesma trinca.' })
        .expect(200);

      const { body: cancelada } = await request(http)
        .get(`/api/v1/nao-conformidades/${nc.id}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(cancelada.status).toBe('CANCELADA');
      expect(cancelada.fechadaEm).not.toBeNull();

      // Sem sincronizar a deteccao, o indicador de precisao do modelo
      // continuaria contando aquela deteccao como acerto.
      const { body: deteccao } = await request(http)
        .get(`/api/v1/deteccoes/${cancelada.deteccaoId}`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(deteccao.statusTriagem).toBe('FALSO_POSITIVO');
    });
  });

  describe('historico', () => {
    it('registra cada transicao com o ator que a fez', async () => {
      const nc = await abrirNc();
      const acaoId = await acaoConcluida(nc.id);

      await request(http)
        .post(`/api/v1/acoes-corretivas/${acaoId}/verificacoes`)
        .set('Authorization', `Bearer ${tokenBruno}`)
        .send({ resultado: 'APROVADA', parecer: 'Conforme a norma.' })
        .expect(201);

      const { body: historico } = await request(http)
        .get(`/api/v1/nao-conformidades/${nc.id}/historico`)
        .set('Authorization', `Bearer ${tokenAna}`)
        .expect(200);

      expect(historico.map((e: { para: string }) => e.para)).toEqual([
        'ABERTA',
        'EM_CORRECAO',
        'AGUARDANDO_VERIFICACAO',
        'RESOLVIDA',
      ]);

      // O ator vem da variavel de sessao definida na transacao — e assim
      // que o trigger, que nao conhece o JWT, sabe quem agiu.
      expect(historico[0].atorId).toBe(idAna);
      expect(historico.at(-1).atorId).not.toBe(idAna);
    });
  });
});
