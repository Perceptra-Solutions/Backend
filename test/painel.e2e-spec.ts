import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * O painel de conformidade contra Postgres real.
 *
 * `painel-sql.spec.ts` ja roda cada agregacao como SQL crua contra as
 * migrations via PGlite. Isto aqui e outra coisa: exercita o
 * `PainelService` DE VERDADE — QueryBuilder do TypeORM gerando o SQL,
 * camelCase virando snake_case, `COUNT(*) FILTER`, `EXTRACT(EPOCH ...)` e o
 * LEFT JOIN cru em `requisito_norma`. Foi exatamente a distancia entre
 * "a SQL esta certa" e "o servico traduz o resultado certo" que escondeu o
 * bug da dedup na ingestao (ver ANDAMENTO.md, secao 4).
 *
 * Os numeros sao provaveis porque toda a massa vive numa obra propria,
 * criada aqui e consultada sempre com `?obraId=`. O seed continua no banco
 * e serve, de quebra, para provar que o filtro isola.
 */
describe('Painel de conformidade (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let ds: DataSource;

  let token: string;
  let obraPainel: string;
  let obraVizinha: string;
  let engenheiro: string;
  let requisitoEstrutural: string;
  let requisitoTermico: string;
  let modeloBom: string;
  let modeloRuim: string;
  let cameraPainel: string;

  const resumo = (query = '') =>
    request(http).get(`/api/v1/painel/resumo${query}`).set('Authorization', `Bearer ${token}`);

  /** Sempre no passado: `fechada_em` nunca pode ser anterior a `aberta_em` (ck_nc_fechada_apos_abertura). */
  const horasAtras = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
  const horasAFrente = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

  /**
   * `prazo` explicito: o trigger `fn_nc_antes_inserir` so calcula a partir da
   * severidade quando vem NULL, entao passar o valor deixa o teste dizer com
   * todas as letras o que quer (vencido / a vencer) em vez de depender da
   * aritmetica de SLA.
   */
  async function inserirNc(opts: {
    obraId?: string;
    severidade?: string;
    status?: string;
    abertaEm?: string;
    fechadaEm?: string | null;
    prazo?: string | null;
    requisitoNormaId?: string | null;
    reincidenciaDeId?: string | null;
  }): Promise<string> {
    const [linha] = await ds.query(
      `INSERT INTO nao_conformidade
         (obra_id, origem, titulo, severidade, status, aberta_em, fechada_em, prazo,
          requisito_norma_id, reincidencia_de_id)
       VALUES ($1,'MANUAL','NC do painel',$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        opts.obraId ?? obraPainel,
        opts.severidade ?? 'MEDIA',
        opts.status ?? 'ABERTA',
        opts.abertaEm ?? horasAtras(48),
        opts.fechadaEm ?? null,
        opts.prazo ?? null,
        opts.requisitoNormaId ?? null,
        opts.reincidenciaDeId ?? null,
      ],
    );
    return linha.id;
  }

  /** `obra_id` da deteccao vem do trigger a partir da camera — nao e informado aqui de proposito. */
  async function inserirDeteccao(modeloIaId: string, statusTriagem: string): Promise<void> {
    const triado = statusTriagem === 'PENDENTE';
    await ds.query(
      `INSERT INTO deteccao (camera_id, modelo_ia_id, classe, confianca, ocorrido_em, status_triagem, triado_por, triado_em)
       VALUES ($1,$2,'TRINCA',0.900,now(),$3,$4,$5)`,
      [cameraPainel, modeloIaId, statusTriagem, triado ? null : engenheiro, triado ? null : new Date()],
    );
  }

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
    token = login.acessoToken;

    [{ id: engenheiro }] = await ds.query(`SELECT id FROM usuario WHERE papel='ENGENHEIRO' LIMIT 1`);

    [{ id: obraPainel }] = await ds.query(
      `INSERT INTO obra (codigo,nome) VALUES ('OB-PAINEL-E2E','Obra do painel') RETURNING id`,
    );
    [{ id: obraVizinha }] = await ds.query(
      `INSERT INTO obra (codigo,nome) VALUES ('OB-VIZINHA-E2E','Obra vizinha') RETURNING id`,
    );

    [{ id: requisitoEstrutural }] = await ds.query(
      `INSERT INTO requisito_norma (norma,item,categoria,descricao)
       VALUES ('NBR 15575','Painel E2E - 1','ESTRUTURAL','Desempenho estrutural') RETURNING id`,
    );
    [{ id: requisitoTermico }] = await ds.query(
      `INSERT INTO requisito_norma (norma,item,categoria,descricao)
       VALUES ('NBR 15575','Painel E2E - 2','TERMICO','Desempenho termico') RETURNING id`,
    );

    [{ id: modeloBom }] = await ds.query(
      `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
       VALUES ('painel-e2e-detector','9.0.0','TRINCA',0.700) RETURNING id`,
    );
    [{ id: modeloRuim }] = await ds.query(
      `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca)
       VALUES ('painel-e2e-detector','9.1.0','TRINCA',0.700) RETURNING id`,
    );

    [{ id: cameraPainel }] = await ds.query(
      `INSERT INTO camera (obra_id,identificador,status) VALUES ($1,'CAM-PAINEL','ATIVA') RETURNING id`,
      [obraPainel],
    );
    await ds.query(
      `INSERT INTO camera (obra_id,identificador,status) VALUES
        ($1,'CAM-PAINEL-2','OFFLINE'), ($1,'CAM-PAINEL-3','OFFLINE'), ($1,'CAM-PAINEL-4','MANUTENCAO')`,
      [obraPainel],
    );

    // ---- NCs nao terminais: 2 CRITICA, 1 ALTA (entram na contagem) ----
    // A CRITICA sem requisito prova o bucket NAO_CLASSIFICADA.
    await inserirNc({ severidade: 'CRITICA', prazo: horasAtras(1), requisitoNormaId: requisitoEstrutural });
    await inserirNc({ severidade: 'CRITICA', prazo: horasAFrente(10), requisitoNormaId: null });
    await inserirNc({
      severidade: 'ALTA',
      status: 'EM_CORRECAO',
      prazo: horasAtras(2),
      requisitoNormaId: requisitoTermico,
    });

    // ---- Terminais: nao entram em severidade/categoria nem em prazo vencido ----
    // Resolvida em 24h exatas -> alimenta o tempo medio de fechamento.
    await inserirNc({
      severidade: 'BAIXA',
      status: 'RESOLVIDA',
      abertaEm: horasAtras(48),
      fechadaEm: horasAtras(24),
      prazo: horasAtras(30),
      requisitoNormaId: requisitoEstrutural,
    });
    // Cancelada TAMBEM tem fechada_em, mas nao conta como fechamento de qualidade.
    await inserirNc({
      severidade: 'CRITICA',
      status: 'CANCELADA',
      abertaEm: horasAtras(200),
      fechadaEm: horasAtras(1),
      prazo: horasAtras(150),
      requisitoNormaId: requisitoEstrutural,
    });

    // ---- Reincidencia: 1 reincidente entre as 5 nao canceladas ----
    const original = await inserirNc({ severidade: 'MEDIA', status: 'RESOLVIDA', fechadaEm: horasAtras(1) });
    await inserirNc({ severidade: 'MEDIA', reincidenciaDeId: original });

    // ---- Obra vizinha: existe so para provar que o filtro isola ----
    await inserirNc({ obraId: obraVizinha, severidade: 'CRITICA', prazo: horasAtras(5) });

    // ---- Deteccoes: modeloRuim 2/4 falso positivo, modeloBom 0/2 ----
    // As PENDENTE ficam FORA do denominador: ainda nao foram julgadas.
    await inserirDeteccao(modeloRuim, 'FALSO_POSITIVO');
    await inserirDeteccao(modeloRuim, 'FALSO_POSITIVO');
    await inserirDeteccao(modeloRuim, 'CONFIRMADA');
    await inserirDeteccao(modeloRuim, 'CONFIRMADA');
    await inserirDeteccao(modeloRuim, 'PENDENTE');
    await inserirDeteccao(modeloBom, 'CONFIRMADA');
    await inserirDeteccao(modeloBom, 'CONFIRMADA');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('contrato da resposta', () => {
    it('devolve todos os cards numa unica requisicao', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);

      expect(Object.keys(body).sort()).toEqual(
        [
          'falsoPositivoPorModelo',
          'ncsAbertasPorCategoria',
          'ncsAbertasPorSeveridade',
          'ncsComPrazoVencido',
          'obraId',
          'saudeDaFrota',
          'taxaReincidencia',
          'tempoMedioFechamentoHoras',
        ].sort(),
      );
    });

    it('obraId vem null quando o resumo cobre todas as obras', async () => {
      const { body } = await resumo().expect(200);
      expect(body.obraId).toBeNull();
    });

    it('ecoa o obraId filtrado', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      expect(body.obraId).toBe(obraPainel);
    });

    it('recusa obraId que nao e uuid', async () => {
      const { body } = await resumo('?obraId=nao-e-uuid').expect(422);
      expect(body.erro.codigo).toBe('VALIDACAO_FALHOU');
    });

    // forbidNonWhitelisted: um parametro inventado nao pode ser ignorado em
    // silencio, senao um filtro com nome errado no front devolve o painel
    // inteiro parecendo filtrado.
    it('recusa parametro desconhecido em vez de ignorar', async () => {
      await resumo('?obraInexistente=1').expect(422);
    });

    it('exige autenticacao', async () => {
      await request(http).get('/api/v1/painel/resumo').expect(401);
    });
  });

  describe('NCs abertas por severidade', () => {
    it('conta as nao terminais e ignora RESOLVIDA e CANCELADA', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const porSeveridade = Object.fromEntries(
        body.ncsAbertasPorSeveridade.map((i: { severidade: string; total: number }) => [i.severidade, i.total]),
      );

      expect(porSeveridade).toEqual({ CRITICA: 2, ALTA: 1, MEDIA: 1 });
      // A BAIXA da obra so existe RESOLVIDA — nao pode aparecer.
      expect(porSeveridade.BAIXA).toBeUndefined();
    });

    it('o filtro por obra isola: a NC da obra vizinha nao entra', async () => {
      const { body: painel } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const { body: vizinha } = await resumo(`?obraId=${obraVizinha}`).expect(200);

      const totalDe = (b: { ncsAbertasPorSeveridade: { total: number }[] }) =>
        b.ncsAbertasPorSeveridade.reduce((s, i) => s + i.total, 0);

      expect(totalDe(painel)).toBe(4);
      expect(totalDe(vizinha)).toBe(1);
    });

    it('total devolve numero, nao string do COUNT do Postgres', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      for (const item of body.ncsAbertasPorSeveridade) {
        expect(typeof item.total).toBe('number');
      }
    });
  });

  describe('NCs abertas por categoria de norma', () => {
    // A regra que mais importa aqui: NC sem requisito vinculado nao pode
    // sumir da contagem, senao a categoria mascara a qualidade da
    // classificacao — quanto pior o processo, melhor pareceria o painel.
    it('NC sem requisito cai em NAO_CLASSIFICADA em vez de desaparecer', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const porCategoria = Object.fromEntries(
        body.ncsAbertasPorCategoria.map((i: { categoria: string; total: number }) => [i.categoria, i.total]),
      );

      expect(porCategoria.ESTRUTURAL).toBe(1);
      expect(porCategoria.TERMICO).toBe(1);
      expect(porCategoria.NAO_CLASSIFICADA).toBe(2);
    });

    it('a soma por categoria bate com a soma por severidade', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);

      const porCategoria = body.ncsAbertasPorCategoria.reduce(
        (s: number, i: { total: number }) => s + i.total,
        0,
      );
      const porSeveridade = body.ncsAbertasPorSeveridade.reduce(
        (s: number, i: { total: number }) => s + i.total,
        0,
      );

      expect(porCategoria).toBe(porSeveridade);
    });
  });

  describe('NCs com prazo vencido', () => {
    it('conta so as nao terminais cujo prazo ja passou', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      // Vencidas e nao terminais: a CRITICA e a ALTA. A CANCELADA e a
      // RESOLVIDA tambem tem prazo no passado, mas fecharam.
      expect(body.ncsComPrazoVencido).toBe(2);
    });

    it('"atrasada" e derivado, nao status: a NC com prazo no futuro fica de fora', async () => {
      const { body } = await resumo(`?obraId=${obraVizinha}`).expect(200);
      expect(body.ncsComPrazoVencido).toBe(1);
    });
  });

  describe('tempo medio de fechamento', () => {
    it('mede so as RESOLVIDA e devolve horas', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);

      // Duas resolvidas: uma de 24h, outra de 47h (48h atras -> 1h atras).
      // A CANCELADA, de ~199h, ficaria gritante na media se entrasse.
      expect(body.tempoMedioFechamentoHoras).toBeGreaterThan(30);
      expect(body.tempoMedioFechamentoHoras).toBeLessThan(40);
    });

    it('null quando a obra nao tem nenhuma NC resolvida', async () => {
      const { body } = await resumo(`?obraId=${obraVizinha}`).expect(200);
      expect(body.tempoMedioFechamentoHoras).toBeNull();
    });
  });

  describe('taxa de reincidencia', () => {
    it('e a fracao de reincidentes sobre as nao canceladas', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      // 6 NCs nao canceladas na obra, 1 com reincidencia_de_id preenchido.
      expect(body.taxaReincidencia).toBeCloseTo(1 / 6, 5);
    });

    it('zero quando a obra nao tem reincidencia', async () => {
      const { body } = await resumo(`?obraId=${obraVizinha}`).expect(200);
      expect(body.taxaReincidencia).toBe(0);
    });
  });

  describe('falso positivo por modelo', () => {
    it('isola por versao de modelo, para um modelo ruim nao se diluir no bom', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const porId = Object.fromEntries(
        body.falsoPositivoPorModelo.map((m: { modeloId: string }) => [m.modeloId, m]),
      );

      // O denominador exclui PENDENTE: o modelo ruim tem 5 deteccoes, 4 triadas.
      expect(porId[modeloRuim]).toMatchObject({
        modeloNome: 'painel-e2e-detector',
        modeloVersao: '9.1.0',
        totalTriado: 4,
        falsosPositivos: 2,
        taxa: 0.5,
      });

      expect(porId[modeloBom]).toMatchObject({
        modeloVersao: '9.0.0',
        totalTriado: 2,
        falsosPositivos: 0,
        taxa: 0,
      });
    });

    // Duas VERSOES do mesmo nome precisam sair em linhas separadas — e o
    // ponto do indicador: descobrir que a 9.1.0 regrediu em relacao a 9.0.0.
    it('mesmo nome em versoes diferentes vira duas linhas', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const doNome = body.falsoPositivoPorModelo.filter(
        (m: { modeloNome: string }) => m.modeloNome === 'painel-e2e-detector',
      );

      expect(doNome).toHaveLength(2);
      expect(doNome.map((m: { modeloVersao: string }) => m.modeloVersao).sort()).toEqual(['9.0.0', '9.1.0']);
    });

    it('lista vazia quando a obra nao tem deteccao', async () => {
      const { body } = await resumo(`?obraId=${obraVizinha}`).expect(200);
      expect(body.falsoPositivoPorModelo).toEqual([]);
    });
  });

  describe('saude da frota', () => {
    it('conta as cameras por status', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);

      expect(body.saudeDaFrota).toEqual({ total: 4, ativas: 1, offline: 2, manutencao: 1 });
    });

    it('zera tudo quando a obra nao tem camera', async () => {
      const { body } = await resumo(`?obraId=${obraVizinha}`).expect(200);
      expect(body.saudeDaFrota).toEqual({ total: 0, ativas: 0, offline: 0, manutencao: 0 });
    });

    it('o total e a soma dos tres status', async () => {
      const { body } = await resumo(`?obraId=${obraPainel}`).expect(200);
      const { total, ativas, offline, manutencao } = body.saudeDaFrota;
      expect(total).toBe(ativas + offline + manutencao);
    });
  });

  describe('sem filtro de obra', () => {
    it('agrega todas as obras, somando o seed com a massa deste teste', async () => {
      const { body: todas } = await resumo().expect(200);
      const { body: painel } = await resumo(`?obraId=${obraPainel}`).expect(200);

      const totalDe = (b: { ncsAbertasPorSeveridade: { total: number }[] }) =>
        b.ncsAbertasPorSeveridade.reduce((s, i) => s + i.total, 0);

      expect(totalDe(todas)).toBeGreaterThan(totalDe(painel));
      expect(todas.saudeDaFrota.total).toBeGreaterThan(painel.saudeDaFrota.total);
    });
  });

  describe('acesso', () => {
    it('ENGENHEIRO tambem le o painel — nao e exclusivo do GESTOR', async () => {
      const { body: login } = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'ana@perceptra.dev', senha: SENHA_PADRAO_SEED })
        .expect(200);

      await request(http)
        .get('/api/v1/painel/resumo')
        .set('Authorization', `Bearer ${login.acessoToken}`)
        .expect(200);
    });
  });
});
