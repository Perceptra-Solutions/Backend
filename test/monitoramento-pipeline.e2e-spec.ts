import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { configurarApp, finalizarApp } from '../src/bootstrap.js';
import { semear } from '../src/database/seed.dados.js';
import { PersistenciaDeteccaoService } from '../src/monitoramento/persistencia-deteccao.service.js';
import type { ResultadoMonitoramento } from '../src/monitoramento/dto/resultado-monitoramento.js';

/**
 * A perna final do pipeline de monitoramento AWS, contra Postgres real.
 *
 *   Raspberry Pi -> s3://raw/ -> inference_service (YOLO) -> s3://processed/*.json
 *   -> fila-resultados-web -> SqsConsumidorService -> **PersistenciaDeteccaoService** -> banco
 *
 * O que este arquivo protege: o contrato entre o `.json` que o serviço de
 * inferência grava (Python, snake_case, classes em português) e o que o
 * backend persiste como `Deteccao`/`Evidencia`. É uma fronteira entre dois
 * repositórios e duas linguagens — nada no typecheck pega uma divergência
 * aqui, e um erro só apareceria em produção como "a Central de Alertas não
 * recebe nada" sem erro nenhum no log.
 *
 * O único ponto simulado é o download da imagem do S3 (sem credencial da AWS
 * neste ambiente). Tudo depois disso é real: hash, storage, transação, FKs,
 * triggers e o índice único que faz a deduplicação.
 */
describe('Pipeline de monitoramento AWS — persistência (e2e)', () => {
  let app: INestApplication<Server>;
  let ds: DataSource;
  let persistencia: PersistenciaDeteccaoService;

  const BUCKET = 'perceptra-epis-1';
  /** JPEG mínimo válido — o serviço hasheia os bytes e grava no storage. */
  const BYTES_IMAGEM = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );

  /**
   * Instala um S3 falso no serviço. O `send` devolve exatamente a forma que o
   * SDK v3 devolve (`Body.transformToByteArray`), que é o que `baixarImagem`
   * consome.
   */
  function simularDownloadS3(): void {
    (persistencia as unknown as { s3: unknown }).s3 = {
      send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(BYTES_IMAGEM) } }),
    };
  }

  /**
   * Um resultado no formato REAL do `inference_service`.
   *
   * A forma de cada detecção vem de `models.py::_para_deteccoes`
   * (`classe_id`, `classe`, `confianca`, `caixa` em [x1,y1,x2,y2]) e os nomes
   * de classe de `config.py::EPI_CLASSES_PT` / `FISSURA_CLASSES_PT`. Os
   * alertas vêm de `rules.py::avaliar_regras`.
   *
   * Já em camelCase porque é assim que `SqsConsumidorService.buscarResultado`
   * entrega — ele traduz `imagem_original` -> `imagemOriginal`,
   * `deteccoes_epi` -> `deteccoesEpi` etc. As detecções de dentro seguem em
   * snake_case, de propósito: são repassadas como vieram do Python.
   */
  function resultadoDoPipeline(imagem: string, sobrescreve: Partial<ResultadoMonitoramento> = {}): ResultadoMonitoramento {
    return {
      imagemOriginal: imagem,
      imagemUrl: `https://${BUCKET}.s3.sa-east-1.amazonaws.com/processed/x.jpg?X-Amz-Signature=fake`,
      deteccoesEpi: [
        { classe_id: 5, classe: 'Pessoa', confianca: 0.91, caixa: [100, 120, 180, 340] },
        { classe_id: 2, classe: 'Sem Capacete', confianca: 0.87, caixa: [110, 120, 170, 180] },
        { classe_id: 4, classe: 'Sem Colete', confianca: 0.72, caixa: [108, 190, 178, 300] },
        { classe_id: 0, classe: 'Capacete', confianca: 0.95, caixa: [400, 100, 440, 140] },
      ],
      deteccoesFissura: [{ classe_id: 0, classe: 'Fissura', confianca: 0.63, caixa: [500, 200, 620, 260] }],
      alertas: [
        { tipo: 'EPI', mensagem: 'Pessoa detectada sem EPI adequado: Sem Capacete, Sem Colete.' },
        { tipo: 'FISSURA', mensagem: 'Fissura estrutural detectada (confiança máx. 63%).' },
      ],
      recebidoEm: new Date().toISOString(),
      ...sobrescreve,
    };
  }

  const contarDeteccoes = async (imagem: string): Promise<number> => {
    const [{ total }] = await ds.query(
      `SELECT count(*)::int AS total FROM deteccao WHERE id_externo LIKE $1`,
      [`${imagem}#%`],
    );
    return total;
  };

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = fixture.createNestApplication();
    configurarApp(app);
    await app.init();
    finalizarApp(app);

    ds = app.get(DataSource);
    persistencia = app.get(PersistenciaDeteccaoService);

    await ds.query(`TRUNCATE nao_conformidade_evento, evidencia, verificacao, acao_corretiva,
      nao_conformidade, deteccao, credencial_dispositivo, camera, local, requisito_norma,
      modelo_ia, obra, usuario, relatorio_item, relatorio RESTART IDENTITY CASCADE`);
    await ds.query(`ALTER SEQUENCE seq_nc_codigo RESTART WITH 1`);
    await semear((sql, params) => ds.query(sql, params as never[]));

    simularDownloadS3();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('provisionamento automático da câmera do pipeline', () => {
    it('registra a Raspberry Pi como Camera na primeira mensagem, sem cadastro manual', async () => {
      const imagem = `raw/rpi01_${Date.now()}.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const [camera] = await ds.query(`SELECT identificador, status, obra_id FROM camera WHERE identificador='RPI-01'`);
      expect(camera).toBeDefined();
      expect(camera.status).toBe('ATIVA');
      expect(camera.obra_id).toBeTruthy();
    });

    it('reaproveita os modelos do catálogo em vez de criar duplicados', async () => {
      const [{ total }] = await ds.query(
        `SELECT count(*)::int AS total FROM modelo_ia WHERE nome IN ('epi-detector','trinca-detector')`,
      );
      // O seed publica 3 versões (epi 2.0.1, trinca 1.2.0 e 1.3.0). Se o
      // serviço tivesse criado modelo próprio, viriam 4 ou mais.
      expect(total).toBe(3);
    });
  });

  describe('tradução do JSON do serviço de inferência', () => {
    it('persiste só as classes de DEFEITO, ignorando as de conformidade', async () => {
      const imagem = `raw/rpi01_${Date.now()}_classes.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const linhas = await ds.query(
        `SELECT classe FROM deteccao WHERE id_externo LIKE $1 ORDER BY classe`,
        [`${imagem}#%`],
      );
      // "Pessoa" e "Capacete" são contexto, não achado — não viram Deteccao.
      expect(linhas.map((l: { classe: string }) => l.classe)).toEqual(['FISSURA', 'SEM_CAPACETE', 'SEM_COLETE']);
    });

    it('converte a caixa [x1,y1,x2,y2] do YOLO em bbox {x,y,w,h}', async () => {
      const imagem = `raw/rpi01_${Date.now()}_bbox.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const [linha] = await ds.query(
        `SELECT bbox FROM deteccao WHERE id_externo LIKE $1 AND classe='SEM_CAPACETE'`,
        [`${imagem}#%`],
      );
      // caixa [110,120,170,180] -> x=110, y=120, w=60, h=60
      expect(linha.bbox).toEqual({ x: 110, y: 120, w: 60, h: 60 });
    });

    it('preserva a confiança do modelo com a precisão da coluna numeric(4,3)', async () => {
      const imagem = `raw/rpi01_${Date.now()}_conf.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const [linha] = await ds.query(
        `SELECT confianca FROM deteccao WHERE id_externo LIKE $1 AND classe='FISSURA'`,
        [`${imagem}#%`],
      );
      expect(Number(linha.confianca)).toBeCloseTo(0.63, 3);
    });

    it('manda a fissura para o modelo estrutural e o EPI para o de EPI', async () => {
      const imagem = `raw/rpi01_${Date.now()}_modelo.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const linhas = await ds.query(
        `SELECT d.classe, m.nome FROM deteccao d
           JOIN modelo_ia m ON m.id = d.modelo_ia_id
          WHERE d.id_externo LIKE $1`,
        [`${imagem}#%`],
      );
      const porClasse = Object.fromEntries(linhas.map((l: { classe: string; nome: string }) => [l.classe, l.nome]));
      expect(porClasse.FISSURA).toBe('trinca-detector');
      expect(porClasse.SEM_CAPACETE).toBe('epi-detector');
    });

    it('o trigger preenche obra_id a partir da câmera, sem o serviço informar', async () => {
      const imagem = `raw/rpi01_${Date.now()}_obra.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const [linha] = await ds.query(
        `SELECT d.obra_id AS det, c.obra_id AS cam FROM deteccao d
           JOIN camera c ON c.id = d.camera_id
          WHERE d.id_externo LIKE $1 LIMIT 1`,
        [`${imagem}#%`],
      );
      expect(linha.det).toBe(linha.cam);
    });
  });

  describe('evidência e cadeia de custódia', () => {
    it('grava a imagem anotada como Evidencia de origem IA, com hash do conteúdo', async () => {
      const imagem = `raw/rpi01_${Date.now()}_evid.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const linhas = await ds.query(
        `SELECT e.origem, e.autor_id, e.hash_sha256, e.mime, e.uri FROM evidencia e
           JOIN deteccao d ON d.id = e.deteccao_id
          WHERE d.id_externo LIKE $1`,
        [`${imagem}#%`],
      );

      expect(linhas.length).toBe(3); // uma por detecção persistida
      for (const e of linhas) {
        expect(e.origem).toBe('IA');
        // ck_evidencia_autor: origem IA não pode ter autor humano.
        expect(e.autor_id).toBeNull();
        expect(e.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(e.mime).toBe('image/jpeg');
        // Chave endereçada por conteúdo: evidencias/<aa>/<bb>/<sha>.jpg
        expect(e.uri).toMatch(/^evidencias\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/);
      }
    });
  });

  describe('reentrega do SQS (at-least-once)', () => {
    /**
     * O SQS entrega a mesma mensagem mais de uma vez por desenho. O
     * `idExterno` é determinístico (`{imagem}#{indice}`), então a segunda
     * passada cai no índice único parcial `ux_deteccao_camera_externo` e é
     * descartada pelo banco.
     */
    it('processar a mesma mensagem duas vezes não duplica detecção nem evidência', async () => {
      const imagem = `raw/rpi01_${Date.now()}_dedup.jpg`;
      const resultado = resultadoDoPipeline(imagem);

      await persistencia.persistir(resultado, BUCKET, 'processed/x.jpg');
      const apos1 = await contarDeteccoes(imagem);

      await persistencia.persistir(resultado, BUCKET, 'processed/x.jpg');
      const apos2 = await contarDeteccoes(imagem);

      expect(apos1).toBe(3);
      expect(apos2).toBe(3);

      const [{ total }] = await ds.query(
        `SELECT count(*)::int AS total FROM evidencia e
           JOIN deteccao d ON d.id = e.deteccao_id
          WHERE d.id_externo LIKE $1`,
        [`${imagem}#%`],
      );
      expect(total).toBe(3);
    });
  });

  describe('escopo: o que NÃO deve virar registro na Central de Alertas', () => {
    it('frame sem alerta nenhum não vira detecção — fica só no feed ao vivo', async () => {
      const imagem = `raw/rpi01_${Date.now()}_semalerta.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem, { alertas: [] }), BUCKET, 'processed/x.jpg');

      expect(await contarDeteccoes(imagem)).toBe(0);
    });

    /**
     * Acontece de verdade: PRESENCA_FORA_DE_TURNO dispara com só "Pessoa" no
     * quadro, e "Pessoa" não é defeito. O alerta existe (e-mail sai pelo SNS),
     * mas não há detecção individual para registrar.
     */
    it('alerta sem classe de defeito no quadro não gera detecção órfã', async () => {
      const imagem = `raw/rpi01_${Date.now()}_turno.jpg`;
      await persistencia.persistir(
        resultadoDoPipeline(imagem, {
          deteccoesEpi: [{ classe_id: 5, classe: 'Pessoa', confianca: 0.94, caixa: [10, 10, 90, 200] }],
          deteccoesFissura: [],
          alertas: [{ tipo: 'PRESENCA_FORA_DE_TURNO', mensagem: 'Pessoa detectada no canteiro fora do horário.' }],
        }),
        BUCKET,
        'processed/x.jpg',
      );

      expect(await contarDeteccoes(imagem)).toBe(0);
    });

    it('classe desconhecida do pipeline é ignorada em vez de virar lixo no banco', async () => {
      const imagem = `raw/rpi01_${Date.now()}_desconhecida.jpg`;
      await persistencia.persistir(
        resultadoDoPipeline(imagem, {
          deteccoesEpi: [{ classe_id: 99, classe: 'Classe Que Nao Existe', confianca: 0.9, caixa: [1, 2, 3, 4] }],
          deteccoesFissura: [],
          alertas: [{ tipo: 'EPI', mensagem: 'alerta com classe nao mapeada' }],
        }),
        BUCKET,
        'processed/x.jpg',
      );

      expect(await contarDeteccoes(imagem)).toBe(0);
    });
  });

  /**
   * ATENÇÃO — divergência real de configuração, fixada aqui como está hoje.
   *
   * O `limiar_confianca` do catálogo (`modelo_ia`) NÃO é aplicado neste
   * caminho. Quem filtra por confiança é o `inference_service`, com limiares
   * próprios e fixos no seu `config.py` (EPI 0.25, fissura 0.40) — o Python
   * nunca consulta o backend. Resultado: mudar o limiar pela API
   * (`PATCH /modelos-ia/:id`) não muda nada no que é detectado nem no que é
   * gravado por aqui.
   *
   * Compare com `POST /dispositivo/deteccoes` (DispositivoService), que
   * respeita o limiar do modelo — os dois caminhos de ingestão têm regras
   * diferentes para a mesma coluna.
   */
  describe('limiar de confiança — divergência entre catálogo e pipeline', () => {
    it('persiste detecção MUITO abaixo do limiar do modelo no catálogo', async () => {
      const [modelo] = await ds.query(`SELECT limiar_confianca FROM modelo_ia WHERE nome='epi-detector' LIMIT 1`);
      const limiarDoCatalogo = Number(modelo.limiar_confianca);
      expect(limiarDoCatalogo).toBeGreaterThan(0.5); // seed: 0.800

      const imagem = `raw/rpi01_${Date.now()}_limiar.jpg`;
      await persistencia.persistir(
        resultadoDoPipeline(imagem, {
          deteccoesEpi: [
            { classe_id: 5, classe: 'Pessoa', confianca: 0.9, caixa: [10, 10, 90, 200] },
            // 0.30: acima do limiar do Python (0.25), muito abaixo do catálogo (0.800).
            { classe_id: 2, classe: 'Sem Capacete', confianca: 0.3, caixa: [12, 12, 60, 60] },
          ],
          deteccoesFissura: [],
          alertas: [{ tipo: 'EPI', mensagem: 'Pessoa detectada sem EPI adequado: Sem Capacete.' }],
        }),
        BUCKET,
        'processed/x.jpg',
      );

      const [linha] = await ds.query(
        `SELECT confianca FROM deteccao WHERE id_externo LIKE $1`,
        [`${imagem}#%`],
      );

      // Gravou mesmo assim: o limiar do catálogo não é consultado aqui.
      expect(linha).toBeDefined();
      expect(Number(linha.confianca)).toBeLessThan(limiarDoCatalogo);
    });
  });

  describe('a detecção chega utilizável na fila de triagem', () => {
    it('nasce PENDENTE, pronta para o engenheiro promover a NC', async () => {
      const imagem = `raw/rpi01_${Date.now()}_triagem.jpg`;
      await persistencia.persistir(resultadoDoPipeline(imagem), BUCKET, 'processed/x.jpg');

      const linhas = await ds.query(
        `SELECT status_triagem, triado_por, triado_em FROM deteccao WHERE id_externo LIKE $1`,
        [`${imagem}#%`],
      );
      for (const l of linhas) {
        expect(l.status_triagem).toBe('PENDENTE');
        expect(l.triado_por).toBeNull();
        expect(l.triado_em).toBeNull();
      }
    });
  });
});
