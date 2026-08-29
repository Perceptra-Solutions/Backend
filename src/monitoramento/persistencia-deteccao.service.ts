import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArmazenamentoPort } from '../armazenamento/armazenamento.port.js';
import { Camera } from '../catalogo-ia/camera.entity.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Evidencia } from '../evidencias/evidencia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { Obra } from '../obras/obra.entity.js';
import { OrigemRegistro, StatusCamera, TipoEvidencia } from '../shared/enums/dominio.enums.js';
import type { DeteccaoBrutaJson, ResultadoMonitoramento } from './dto/resultado-monitoramento.js';

const IDENTIFICADOR_CAMERA = 'RPI-01';
const NOME_MODELO_EPI = 'epi-detector';
const NOME_MODELO_FISSURA = 'trinca-detector';

/**
 * Mapa das classes "problema" do `.json` do pipeline (português, ver
 * inference_service/config.py) para o código que a Central de Alertas já
 * reconhece (inglês, maiúsculo — convenção herdada do seed de demo, ver
 * `CLASSES_EPI`/`CLASSES_ESTRUTURAIS` em Front/src/lib/adapters.ts).
 *
 * Só entra aqui o que é DEFEITO: classes de conformidade (Capacete, Colete
 * de Segurança, Máscara, Pessoa, Cone, Maquinário, Veículo) não viram
 * Deteccao — não são achado, são contexto. O pipeline Python já faz essa
 * mesma distinção nas 3 regras de alerta (ver inference_service/rules.py);
 * aqui só persiste o que já cruzou o limiar de virar alerta de verdade.
 */
const CLASSE_PARA_CODIGO: Record<string, string> = {
  'Sem Capacete': 'SEM_CAPACETE',
  'Sem Colete': 'SEM_COLETE',
  'Sem Máscara': 'SEM_MASCARA',
  Fissura: 'FISSURA',
};

interface DeteccaoCandidata {
  classe: string;
  confianca: number;
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * Faz a ponte entre o feed ao vivo (SSE, efêmero, ver SqsConsumidorService)
 * e a Central de Alertas (persistente, fila de triagem do engenheiro).
 *
 * Decisão de escopo: só persiste quando `resultado.alertas` não é vazio —
 * "os avisos que vão pro e-mail" é literalmente o pedido. Uma imagem sem
 * nenhuma das 3 regras disparada (a maioria) não vira Deteccao; continua só
 * no feed ao vivo, sem poluir a fila de triagem com conformidade.
 */
@Injectable()
export class PersistenciaDeteccaoService {
  private readonly logger = new Logger(PersistenciaDeteccaoService.name);

  private s3?: S3Client;
  private bucket = '';

  private cameraId?: string;
  private modeloEpiId?: string;
  private modeloFissuraId?: string;
  private resolvendo?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly armazenamento: ArmazenamentoPort,
    @InjectRepository(Deteccao) private readonly deteccoes: Repository<Deteccao>,
    @InjectRepository(Evidencia) private readonly evidencias: Repository<Evidencia>,
    @InjectRepository(Camera) private readonly cameras: Repository<Camera>,
    @InjectRepository(ModeloIa) private readonly modelos: Repository<ModeloIa>,
    @InjectRepository(Obra) private readonly obras: Repository<Obra>,
  ) {}

  async persistir(resultado: ResultadoMonitoramento, bucket: string, chaveImagem: string): Promise<void> {
    if (resultado.alertas.length === 0) return;

    const candidatas = this.extrairCandidatas(resultado);
    if (candidatas.length === 0) {
      // Aconteceu na prática: PRESENCA_FORA_DE_TURNO dispara sem nenhuma
      // classe "Sem X"/Fissura no frame (só "Pessoa", que não é defeito).
      // Nada de errado — só não há detecção individual pra registrar.
      this.logger.debug(`Alerta sem classe mapeável para persistir: ${resultado.imagemOriginal}`);
      return;
    }

    await this.garantirCadastros();

    const pastaTmp = await mkdtemp(join(tmpdir(), 'perceptra-monitoramento-'));
    try {
      const caminhoLocal = join(pastaTmp, 'frame.jpg');
      const bytes = await this.baixarImagem(bucket, chaveImagem);
      await writeFile(caminhoLocal, bytes);

      const hash = createHash('sha256').update(bytes).digest('hex');
      const chaveEvidencia = `evidencias/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.jpg`;
      await this.armazenamento.salvar(chaveEvidencia, caminhoLocal, 'image/jpeg');

      for (const [indice, candidata] of candidatas.entries()) {
        await this.inserirDeteccaoComEvidencia(resultado, indice, candidata, chaveEvidencia, hash, bytes.length);
      }
    } finally {
      await rm(pastaTmp, { recursive: true, force: true });
    }
  }

  private async inserirDeteccaoComEvidencia(
    resultado: ResultadoMonitoramento,
    indice: number,
    candidata: DeteccaoCandidata,
    chaveEvidencia: string,
    hash: string,
    tamanhoBytes: number,
  ): Promise<void> {
    const modeloId = candidata.classe === 'FISSURA' ? this.modeloFissuraId! : this.modeloEpiId!;
    // idExterno determinístico: reprocessar a mesma mensagem SQS (SQS é
    // at-least-once) cai no mesmo par (camera, idExterno) e o índice único
    // parcial `ux_deteccao_camera_externo` descarta a repetição sozinho.
    const idExterno = `${resultado.imagemOriginal}#${indice}`;

    const inserida = await this.deteccoes
      .createQueryBuilder()
      .insert()
      .into(Deteccao)
      .values({
        cameraId: this.cameraId!,
        modeloIaId: modeloId,
        idExterno,
        classe: candidata.classe,
        confianca: candidata.confianca,
        bbox: candidata.bbox,
        ocorridoEm: new Date(resultado.recebidoEm),
      })
      .orIgnore()
      .execute();

    const deteccaoId = inserida.identifiers[0]?.id as string | undefined;
    if (!deteccaoId) return; // já existia (reentrega do SQS) — não duplica evidência

    await this.evidencias.insert({
      tipo: TipoEvidencia.FOTO,
      uri: chaveEvidencia,
      hashSha256: hash,
      origem: OrigemRegistro.IA,
      autorId: null,
      deteccaoId,
      naoConformidadeId: null,
      acaoCorretivaId: null,
      tamanhoBytes: String(tamanhoBytes),
      mime: 'image/jpeg',
    });
  }

  private extrairCandidatas(resultado: ResultadoMonitoramento): DeteccaoCandidata[] {
    const todas = [...resultado.deteccoesEpi, ...resultado.deteccoesFissura];
    const candidatas: DeteccaoCandidata[] = [];
    for (const d of todas) {
      const classe = CLASSE_PARA_CODIGO[d.classe];
      if (!classe) continue; // classe de conformidade (Capacete, Pessoa, ...) — não é defeito
      candidatas.push({ classe, confianca: d.confianca, bbox: this.caixaParaBbox(d) });
    }
    return candidatas;
  }

  private caixaParaBbox(d: DeteccaoBrutaJson): { x: number; y: number; w: number; h: number } {
    const [x1, y1, x2, y2] = d.caixa;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /**
   * O cliente é criado com as MESMAS credenciais do `SqsConsumidorService`
   * (`MONITORAMENTO_AWS_*`), e não pela cadeia de provedores padrão do SDK.
   *
   * Passar credencial explícita aqui não é preciosismo: dentro do container
   * não existe `~/.aws`, nem role de instância, nem `AWS_*` no ambiente — a
   * cadeia padrão não encontra nada e o download falha com
   * `Could not load credentials from any providers`. Como a persistência é
   * best-effort (ver `persistirComTolerancia`), o erro virava só um WARN: o
   * feed ao vivo seguia funcionando e NENHUMA detecção do pipeline AWS
   * chegava na Central de Alertas, sem nada gritar. Foi assim que apareceu,
   * num teste de ponta a ponta contra a AWS real.
   */
  private async baixarImagem(bucket: string, chave: string): Promise<Buffer> {
    if (!this.s3) {
      const accessKeyId = this.config.get<string>('monitoramento.accessKeyId');
      const secretAccessKey = this.config.get<string>('monitoramento.secretAccessKey');

      this.s3 = new S3Client({
        region: this.config.get<string>('monitoramento.regiao') ?? 'sa-east-1',
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      });
      this.bucket = bucket;
    }
    const objeto = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
    return Buffer.from(await objeto.Body!.transformToByteArray());
  }

  /**
   * Câmera + modelos do pipeline AWS, resolvidos (e criados, se preciso) uma
   * vez e cacheados em memória — mesmo padrão de cache do ApiKeyGuard.
   * `resolvendo` evita corrida entre duas mensagens processadas em paralelo
   * tentando criar a câmera duas vezes.
   */
  private async garantirCadastros(): Promise<void> {
    if (this.cameraId && this.modeloEpiId && this.modeloFissuraId) return;
    if (!this.resolvendo) this.resolvendo = this.resolverCadastros();
    await this.resolvendo;
  }

  private async resolverCadastros(): Promise<void> {
    const obra = await this.obras.findOne({ where: {}, order: { criadoEm: 'ASC' } });
    if (!obra) {
      throw new Error(
        'Nenhuma obra cadastrada — rode o seed (npm run db:seed) antes de processar detecções do monitoramento.',
      );
    }

    this.modeloEpiId = await this.resolverModelo(NOME_MODELO_EPI, 'EPI');
    this.modeloFissuraId = await this.resolverModelo(NOME_MODELO_FISSURA, 'ESTRUTURAL');
    this.cameraId = await this.resolverCamera(obra.id, this.modeloEpiId);
  }

  private async resolverModelo(nome: string, tipoDeteccao: string): Promise<string> {
    const existente = await this.modelos.findOne({ where: { nome, ativo: true }, order: { publicadoEm: 'DESC' } });
    if (existente) return existente.id;

    this.logger.warn(`Modelo "${nome}" não encontrado (seed não rodado?) — criando um mínimo para não travar.`);
    const criado = await this.modelos.save(
      this.modelos.create({ nome, versao: 'rpi-1.0.0', tipoDeteccao, limiarConfianca: 0 }),
    );
    return criado.id;
  }

  private async resolverCamera(obraId: string, modeloIaId: string): Promise<string> {
    const existente = await this.cameras.findOne({ where: { obraId, identificador: IDENTIFICADOR_CAMERA } });
    if (existente) return existente.id;

    this.logger.log(`Registrando a câmera do pipeline AWS ("${IDENTIFICADOR_CAMERA}") na obra ${obraId}.`);
    const criada = await this.cameras.save(
      this.cameras.create({
        obraId,
        localId: null,
        modeloIaId,
        identificador: IDENTIFICADOR_CAMERA,
        fabricante: 'Raspberry Pi 3 + webcam USB',
        protocolo: 'S3',
        status: StatusCamera.ATIVA,
        ultimoHeartbeat: new Date(),
      }),
    );
    return criada.id;
  }
}
