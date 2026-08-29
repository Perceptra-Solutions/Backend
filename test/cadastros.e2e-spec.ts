import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear, SENHA_PADRAO_SEED } from '../src/database/seed.dados.js';

/**
 * Os cinco CRUDs de cadastro: obras, locais, requisitos de norma, modelos de
 * IA e cameras.
 *
 * Duas decisoes do projeto so podem ser verificadas por aqui, contra um
 * Postgres de verdade:
 *
 * 1. **"FK nao e dependencia de modulo"** (ANDAMENTO.md, secao 6, regra 1).
 *    Nenhum service valida se `obraId`/`localId`/`modeloIaId` existe antes
 *    de gravar — quem checa e a FK, e o `erro-postgres.mapper.ts` traduz o
 *    23503 em 422 REFERENCIA_INVALIDA. Sem banco real nao ha 23503 nenhum,
 *    entao esse caminho inteiro so existe no e2e.
 * 2. **Unicidade vira 409 com codigo proprio**, tambem traduzida do SQLSTATE
 *    23505 pelo nome da constraint.
 *
 * Um UUID sintaticamente valido mas inexistente. Passa no ParseUUIDPipe e
 * chega ate a FK — que e exatamente o que se quer exercitar.
 */
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('Cadastros — obras, locais, normas, modelos e cameras (e2e)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let ds: DataSource;

  let gestor: string;
  let engenheiro: string;

  let obraId: string;
  let localId: string;
  let modeloId: string;
  let cameraId: string;

  /** Sufixo por suite, para os codigos unicos nao colidirem com o seed. */
  const sufixo = 'E2E';

  const comGestor = (m: 'get' | 'post' | 'patch', url: string) =>
    request(http)[m](`/api/v1${url}`).set('Authorization', `Bearer ${gestor}`);
  const comEngenheiro = (m: 'get' | 'post' | 'patch', url: string) =>
    request(http)[m](`/api/v1${url}`).set('Authorization', `Bearer ${engenheiro}`);

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

    ds = app.get(DataSource);
    await ds.query(`TRUNCATE nao_conformidade_evento, evidencia, verificacao, acao_corretiva,
      nao_conformidade, deteccao, credencial_dispositivo, camera, local, requisito_norma,
      modelo_ia, obra, usuario, relatorio_item, relatorio RESTART IDENTITY CASCADE`);
    await ds.query(`ALTER SEQUENCE seq_nc_codigo RESTART WITH 1`);
    await semear((sql, params) => ds.query(sql, params as never[]));

    [gestor, engenheiro] = await Promise.all([
      login('gestora@perceptra.dev'),
      login('ana@perceptra.dev'),
    ]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // =====================================================================
  describe('obras', () => {
    it('GESTOR cadastra e a obra volta com id e status padrao', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({ codigo: `OB-${sufixo}-1`, nome: 'Residencial Teste', uf: 'MG', cidade: 'Belo Horizonte' })
        .expect(201);

      expect(body.id).toBeTruthy();
      expect(body).toMatchObject({ codigo: `OB-${sufixo}-1`, nome: 'Residencial Teste', status: 'EM_ANDAMENTO' });
      obraId = body.id;
    });

    it('ENGENHEIRO nao cadastra obra', async () => {
      await comEngenheiro('post', '/obras')
        .send({ codigo: `OB-${sufixo}-PROIBIDO`, nome: 'Nao deveria existir' })
        .expect(403);
    });

    it('ENGENHEIRO le a lista — leitura nao e exclusiva do GESTOR', async () => {
      const { body } = await comEngenheiro('get', '/obras').expect(200);
      expect(body.itens.length).toBeGreaterThan(0);
    });

    // O @Transform faz trim e uppercase; sem ele o CHECK ck_obra_uf
    // devolveria 409 para um "mg" que o usuario digitou em minusculo.
    it('normaliza a entrada: trim no nome e UF em maiusculo', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({ codigo: `  OB-${sufixo}-2  `, nome: '  Obra com espacos  ', uf: 'sp' })
        .expect(201);

      expect(body.codigo).toBe(`OB-${sufixo}-2`);
      expect(body.nome).toBe('Obra com espacos');
      expect(body.uf).toBe('SP');
    });

    it('codigo repetido vira 409 com codigo de erro proprio', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({ codigo: `OB-${sufixo}-1`, nome: 'Outra obra, mesmo codigo' })
        .expect(409);

      expect(body.erro.codigo).toBe('CODIGO_OBRA_DUPLICADO');
    });

    // ck_obra_datas: o CHECK do banco e a rede de seguranca, e o mapper
    // traduz o 23514 numa mensagem util em vez de 500.
    it('fim previsto antes do inicio vira 422 com mensagem de negocio', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({
          codigo: `OB-${sufixo}-DATAS`,
          nome: 'Obra com datas invertidas',
          inicioPrevisto: '2026-12-01',
          fimPrevisto: '2026-01-01',
        })
        .expect(422);

      expect(body.erro.codigo).toBe('DATAS_OBRA_INVALIDAS');
    });

    it('UF com mais de duas letras para na validacao, antes do banco', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({ codigo: `OB-${sufixo}-UF`, nome: 'Obra UF', uf: 'MGX' })
        .expect(422);

      expect(body.erro.codigo).toBe('VALIDACAO_FALHOU');
    });

    it('responsavel tecnico inexistente vira 422 pela FK, nao 500', async () => {
      const { body } = await comGestor('post', '/obras')
        .send({ codigo: `OB-${sufixo}-FK`, nome: 'Obra sem responsavel', responsavelTecnicoId: UUID_INEXISTENTE })
        .expect(422);

      expect(body.erro.codigo).toBe('REFERENCIA_INVALIDA');
    });

    it('detalha por id', async () => {
      const { body } = await comGestor('get', `/obras/${obraId}`).expect(200);
      expect(body.id).toBe(obraId);
    });

    it('404 em obra inexistente', async () => {
      await comGestor('get', `/obras/${UUID_INEXISTENTE}`).expect(404);
    });

    /**
     * ATENCAO — inconsistencia de contrato, fixada aqui como esta hoje.
     *
     * Id malformado no PATH devolve **400** (`REQUISICAO_INVALIDA`), enquanto
     * corpo e query malformados devolvem **422** (`VALIDACAO_FALHOU`). Sao
     * dois codigos para a mesma classe de erro: "voce mandou algo invalido".
     *
     * A causa: `criarValidationPipe()` define
     * `errorHttpStatusCode: UNPROCESSABLE_ENTITY`, mas cada `ParseUUIDPipe`
     * nos parametros de rota (48 no projeto) usa o proprio default do Nest,
     * que e BadRequest. Uniformizar exige passar
     * `new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY })`
     * em todos — mudanca de contrato publico, decisao de quem mantem a API.
     *
     * Ate la, este teste existe para que a divergencia seja uma escolha
     * visivel e nao uma surpresa para quem consome a API.
     */
    it('id malformado no path devolve 400, nao o 422 do resto da validacao', async () => {
      const { body } = await comGestor('get', '/obras/abc').expect(400);
      expect(body.erro.codigo).toBe('REQUISICAO_INVALIDA');

      // O contraste, na mesma suite: query invalida na mesma rota da 422.
      await comGestor('get', '/obras?obraId=abc').expect(422);
    });

    it('GESTOR atualiza; ENGENHEIRO recebe 403', async () => {
      const { body } = await comGestor('patch', `/obras/${obraId}`)
        .send({ nome: 'Residencial Teste (renomeado)', status: 'PARALISADA' })
        .expect(200);

      expect(body).toMatchObject({ nome: 'Residencial Teste (renomeado)', status: 'PARALISADA' });

      await comEngenheiro('patch', `/obras/${obraId}`).send({ nome: 'nao' }).expect(403);
    });

    it('filtra por status e por uf', async () => {
      const { body: paralisadas } = await comGestor('get', '/obras?status=PARALISADA').expect(200);
      expect(paralisadas.itens.every((o: { status: string }) => o.status === 'PARALISADA')).toBe(true);
      expect(paralisadas.itens.some((o: { id: string }) => o.id === obraId)).toBe(true);

      const { body: sp } = await comGestor('get', '/obras?uf=SP').expect(200);
      expect(sp.itens.every((o: { uf: string }) => o.uf === 'SP')).toBe(true);
    });

    it('pagina, e o total conta o conjunto inteiro, nao a pagina', async () => {
      const { body } = await comGestor('get', '/obras?pagina=1&tamanho=2').expect(200);

      expect(body.itens.length).toBeLessThanOrEqual(2);
      expect(body.tamanho).toBe(2);
      expect(body.total).toBeGreaterThanOrEqual(body.itens.length);
      expect(body.totalPaginas).toBe(Math.ceil(body.total / 2));
    });

    it('recusa tamanho de pagina acima do teto', async () => {
      await comGestor('get', '/obras?tamanho=500').expect(422);
    });

    // forbidNonWhitelisted: filtro escrito errado no front nao pode ser
    // ignorado em silencio e devolver a lista inteira parecendo filtrada.
    it('recusa filtro desconhecido em vez de ignorar', async () => {
      await comGestor('get', '/obras?statuss=PARALISADA').expect(422);
    });
  });

  // =====================================================================
  describe('locais', () => {
    it('GESTOR cadastra um local dentro da obra', async () => {
      const { body } = await comGestor('post', '/locais')
        .send({ obraId, tipo: 'BLOCO', nome: 'Torre C', codigo: `C-${sufixo}` })
        .expect(201);

      expect(body).toMatchObject({ obraId, tipo: 'BLOCO', nome: 'Torre C' });
      localId = body.id;
    });

    it('obra inexistente vira 422 pela FK — o service nao pre-valida de proposito', async () => {
      const { body } = await comGestor('post', '/locais')
        .send({ obraId: UUID_INEXISTENTE, tipo: 'BLOCO', nome: 'Torre fantasma' })
        .expect(422);

      expect(body.erro.codigo).toBe('REFERENCIA_INVALIDA');
    });

    it('codigo repetido na MESMA obra vira 409', async () => {
      const { body } = await comGestor('post', '/locais')
        .send({ obraId, tipo: 'PAVIMENTO', nome: 'Outro local', codigo: `C-${sufixo}` })
        .expect(409);

      expect(body.erro.codigo).toBe('CODIGO_LOCAL_DUPLICADO');
    });

    // A unicidade e (obra_id, codigo), nao codigo global: o mesmo "C-01"
    // pode existir em duas obras diferentes sem conflito.
    it('o mesmo codigo em OUTRA obra e aceito', async () => {
      const { body: outraObra } = await comGestor('post', '/obras')
        .send({ codigo: `OB-${sufixo}-3`, nome: 'Obra para o mesmo codigo de local' })
        .expect(201);

      await comGestor('post', '/locais')
        .send({ obraId: outraObra.id, tipo: 'BLOCO', nome: 'Torre C', codigo: `C-${sufixo}` })
        .expect(201);
    });

    it('tipo fora do enum para na validacao', async () => {
      await comGestor('post', '/locais').send({ obraId, tipo: 'GARAGEM_SUBTERRANEA', nome: 'X' }).expect(422);
    });

    it('atualiza nome e tipo', async () => {
      const { body } = await comGestor('patch', `/locais/${localId}`)
        .send({ nome: 'Torre C - renomeada', tipo: 'AREA_COMUM' })
        .expect(200);

      expect(body).toMatchObject({ nome: 'Torre C - renomeada', tipo: 'AREA_COMUM' });
    });

    // AtualizarLocalDto e OmitType(..., ['obraId']): um local nao troca de
    // obra depois de criado, e com forbidNonWhitelisted a tentativa e
    // recusada em vez de silenciosamente ignorada.
    it('nao deixa mudar a obra do local', async () => {
      const { body } = await comGestor('patch', `/locais/${localId}`)
        .send({ obraId: UUID_INEXISTENTE })
        .expect(422);

      expect(body.erro.codigo).toBe('VALIDACAO_FALHOU');
    });

    it('filtra por obra e por tipo', async () => {
      const { body } = await comGestor('get', `/locais?obraId=${obraId}`).expect(200);
      expect(body.itens.length).toBeGreaterThan(0);
      expect(body.itens.every((l: { obraId: string }) => l.obraId === obraId)).toBe(true);

      const { body: comuns } = await comGestor('get', `/locais?obraId=${obraId}&tipo=AREA_COMUM`).expect(200);
      expect(comuns.itens.every((l: { tipo: string }) => l.tipo === 'AREA_COMUM')).toBe(true);
    });
  });

  // =====================================================================
  describe('requisitos de norma', () => {
    let requisitoId: string;

    it('GESTOR cadastra um requisito', async () => {
      const { body } = await comGestor('post', '/requisitos-norma')
        .send({
          norma: 'NBR 15575',
          item: `Cadastros ${sufixo} - 1`,
          categoria: 'ACUSTICO',
          descricao: 'Desempenho acustico de vedacoes verticais',
        })
        .expect(201);

      expect(body).toMatchObject({ norma: 'NBR 15575', categoria: 'ACUSTICO' });
      requisitoId = body.id;
    });

    it('norma + item repetidos viram 409', async () => {
      const { body } = await comGestor('post', '/requisitos-norma')
        .send({
          norma: 'NBR 15575',
          item: `Cadastros ${sufixo} - 1`,
          categoria: 'TERMICO',
          descricao: 'Mesma norma e item, categoria diferente',
        })
        .expect(409);

      expect(body.erro.codigo).toBe('REQUISITO_NORMA_DUPLICADO');
    });

    it('categoria fora do enum para na validacao', async () => {
      await comGestor('post', '/requisitos-norma')
        .send({ norma: 'NBR 1', item: 'X', categoria: 'HIDRAULICO', descricao: 'Categoria inexistente' })
        .expect(422);
    });

    it('ENGENHEIRO nao cadastra, mas lista', async () => {
      await comEngenheiro('post', '/requisitos-norma')
        .send({ norma: 'NBR 1', item: 'Y', categoria: 'OUTRO', descricao: 'Nao deveria entrar' })
        .expect(403);

      await comEngenheiro('get', '/requisitos-norma').expect(200);
    });

    it('atualiza a descricao', async () => {
      const { body } = await comGestor('patch', `/requisitos-norma/${requisitoId}`)
        .send({ descricao: 'Descricao revisada' })
        .expect(200);

      expect(body.descricao).toBe('Descricao revisada');
    });

    it('filtra por categoria e por norma', async () => {
      const { body } = await comGestor('get', '/requisitos-norma?categoria=ACUSTICO').expect(200);
      expect(body.itens.every((r: { categoria: string }) => r.categoria === 'ACUSTICO')).toBe(true);
      expect(body.itens.some((r: { id: string }) => r.id === requisitoId)).toBe(true);
    });
  });

  // =====================================================================
  describe('modelos de IA', () => {
    it('GESTOR publica uma versao', async () => {
      const { body } = await comGestor('post', '/modelos-ia')
        .send({ nome: `cadastro-${sufixo}`, versao: '1.0.0', tipoDeteccao: 'trinca', limiarConfianca: 0.8 })
        .expect(201);

      // tipoDeteccao passa por @Transform toUpperCase.
      expect(body).toMatchObject({ versao: '1.0.0', tipoDeteccao: 'TRINCA', ativo: true });
      expect(Number(body.limiarConfianca)).toBeCloseTo(0.8, 3);
      modeloId = body.id;
    });

    it('nome + versao repetidos viram 409', async () => {
      const { body } = await comGestor('post', '/modelos-ia')
        .send({ nome: `cadastro-${sufixo}`, versao: '1.0.0', tipoDeteccao: 'TRINCA' })
        .expect(409);

      expect(body.erro.codigo).toBe('MODELO_VERSAO_DUPLICADA');
    });

    it('a mesma versao com nome diferente entra normalmente', async () => {
      await comGestor('post', '/modelos-ia')
        .send({ nome: `cadastro-${sufixo}-outro`, versao: '1.0.0', tipoDeteccao: 'EPI' })
        .expect(201);
    });

    it('limiar fora de 0..1 para na validacao', async () => {
      await comGestor('post', '/modelos-ia')
        .send({ nome: `cadastro-${sufixo}-limiar`, versao: '1.0.0', tipoDeteccao: 'EPI', limiarConfianca: 1.5 })
        .expect(422);
    });

    it('aposenta a versao e reajusta o limiar', async () => {
      const { body } = await comGestor('patch', `/modelos-ia/${modeloId}`)
        .send({ ativo: false, limiarConfianca: 0.55 })
        .expect(200);

      expect(body.ativo).toBe(false);
      expect(Number(body.limiarConfianca)).toBeCloseTo(0.55, 3);
    });

    /**
     * Versao publicada e imutavel: o trigger `trg_modelo_ia_imutavel` bloqueia
     * UPDATE de qualquer coluna que nao seja `ativo`/`limiar_confianca`. O DTO
     * nem expoe as outras, entao a tentativa morre antes, na validacao — que
     * e a mensagem mais util. O trigger continua sendo a rede contra um
     * UPDATE vindo de script.
     */
    it('nao deixa reescrever nome nem versao de um modelo publicado', async () => {
      const { body: porNome } = await comGestor('patch', `/modelos-ia/${modeloId}`)
        .send({ nome: 'nome-novo' })
        .expect(422);
      expect(porNome.erro.codigo).toBe('VALIDACAO_FALHOU');

      await comGestor('patch', `/modelos-ia/${modeloId}`).send({ versao: '2.0.0' }).expect(422);
      await comGestor('patch', `/modelos-ia/${modeloId}`).send({ tipoDeteccao: 'EPI' }).expect(422);
    });

    it('o trigger tambem bloqueia por baixo da API, num UPDATE direto', async () => {
      await expect(
        ds.query(`UPDATE modelo_ia SET nome='burlado' WHERE id=$1`, [modeloId]),
      ).rejects.toThrow();
    });

    it('filtra por ativo e por nome', async () => {
      const { body: inativos } = await comGestor('get', '/modelos-ia?ativo=false').expect(200);
      expect(inativos.itens.every((m: { ativo: boolean }) => m.ativo === false)).toBe(true);
      expect(inativos.itens.some((m: { id: string }) => m.id === modeloId)).toBe(true);

      const { body: porNome } = await comGestor('get', `/modelos-ia?nome=cadastro-${sufixo}`).expect(200);
      expect(porNome.itens.length).toBeGreaterThan(0);
    });

    it('ENGENHEIRO nao publica versao', async () => {
      await comEngenheiro('post', '/modelos-ia')
        .send({ nome: 'proibido', versao: '1.0.0', tipoDeteccao: 'EPI' })
        .expect(403);
    });
  });

  // =====================================================================
  describe('cameras', () => {
    it('GESTOR cadastra uma camera, que nasce ATIVA', async () => {
      const { body } = await comGestor('post', '/cameras')
        .send({ obraId, localId, identificador: `CAM-${sufixo}-1`, fabricante: 'Hikvision', protocolo: 'rtsp' })
        .expect(201);

      expect(body).toMatchObject({
        obraId,
        localId,
        identificador: `CAM-${sufixo}-1`,
        protocolo: 'RTSP', // @Transform toUpperCase
        status: 'ATIVA',
      });
      cameraId = body.id;
    });

    it('identificador repetido na mesma obra vira 409', async () => {
      const { body } = await comGestor('post', '/cameras')
        .send({ obraId, identificador: `CAM-${sufixo}-1` })
        .expect(409);

      expect(body.erro.codigo).toBe('IDENTIFICADOR_CAMERA_DUPLICADO');
    });

    it('modelo de IA inexistente vira 422 pela FK', async () => {
      const { body } = await comGestor('post', '/cameras')
        .send({ obraId, identificador: `CAM-${sufixo}-FK`, modeloIaId: UUID_INEXISTENTE })
        .expect(422);

      expect(body.erro.codigo).toBe('REFERENCIA_INVALIDA');
    });

    /**
     * `urlStream` carrega usuario:senha do RTSP. Fica fora do DTO de criacao
     * (so `PATCH :id/stream` grava, sempre cifrado) e a coluna e
     * `select: false` na entidade. Sao duas barreiras, e as duas sao
     * verificadas aqui: a API recusa receber, e nunca devolve.
     */
    it('nao aceita urlStream no cadastro', async () => {
      await comGestor('post', '/cameras')
        .send({ obraId, identificador: `CAM-${sufixo}-STREAM`, urlStream: 'rtsp://user:senha@10.0.0.9/live' })
        .expect(422);
    });

    it('nunca devolve urlStream, nem depois de gravada e cifrada', async () => {
      await comGestor('patch', `/cameras/${cameraId}/stream`)
        .send({ urlStream: 'rtsp://user:senha@10.0.0.9/live' })
        .expect(200);

      const { body: detalhe } = await comGestor('get', `/cameras/${cameraId}`).expect(200);
      expect(detalhe).not.toHaveProperty('urlStream');
      expect(JSON.stringify(detalhe)).not.toContain('10.0.0.9');

      const { body: lista } = await comGestor('get', `/cameras?obraId=${obraId}`).expect(200);
      expect(JSON.stringify(lista)).not.toContain('10.0.0.9');
    });

    it('a url de stream fica cifrada no banco, nunca em texto plano', async () => {
      const [linha] = await ds.query(`SELECT url_stream FROM camera WHERE id=$1`, [cameraId]);

      expect(linha.url_stream).toMatch(/^enc:v1:/);
      expect(linha.url_stream).not.toContain('10.0.0.9');
      expect(linha.url_stream).not.toContain('senha');
    });

    it('marca MANUTENCAO manualmente pelo PATCH', async () => {
      const { body } = await comGestor('patch', `/cameras/${cameraId}`)
        .send({ status: 'MANUTENCAO' })
        .expect(200);

      expect(body.status).toBe('MANUTENCAO');
    });

    it('nao deixa mudar a obra da camera', async () => {
      await comGestor('patch', `/cameras/${cameraId}`).send({ obraId: UUID_INEXISTENTE }).expect(422);
    });

    it('filtra por obra, por status e por local', async () => {
      const { body: manutencao } = await comGestor(
        'get',
        `/cameras?obraId=${obraId}&status=MANUTENCAO`,
      ).expect(200);
      expect(manutencao.itens.every((c: { status: string }) => c.status === 'MANUTENCAO')).toBe(true);
      expect(manutencao.itens.some((c: { id: string }) => c.id === cameraId)).toBe(true);

      const { body: doLocal } = await comGestor('get', `/cameras?localId=${localId}`).expect(200);
      expect(doLocal.itens.every((c: { localId: string }) => c.localId === localId)).toBe(true);
    });

    it('ENGENHEIRO nao cadastra camera, mas lista', async () => {
      await comEngenheiro('post', '/cameras').send({ obraId, identificador: 'CAM-PROIBIDA' }).expect(403);
      await comEngenheiro('get', '/cameras').expect(200);
    });

    it('404 em camera inexistente', async () => {
      await comGestor('get', `/cameras/${UUID_INEXISTENTE}`).expect(404);
    });
  });

  // =====================================================================
  describe('nenhum cadastro expoe exclusao', () => {
    // Decisao do projeto: sem DELETE em lugar nenhum. As FKs sao RESTRICT e
    // protegem quem tem dependente; o caminho e desativar, nao apagar.
    it.each([
      ['/obras', () => obraId],
      ['/locais', () => localId],
      ['/modelos-ia', () => modeloId],
      ['/cameras', () => cameraId],
    ])('DELETE %s/:id nao existe', async (rota, id) => {
      await request(http)
        .delete(`/api/v1${rota}/${id()}`)
        .set('Authorization', `Bearer ${gestor}`)
        .expect(404);
    });
  });
});
