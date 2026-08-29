import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DeleteMessageCommand, type Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { EventosMonitoramentoService } from './eventos-monitoramento.service.js';
import type { DeteccaoBrutaJson, ResultadoMonitoramento } from './dto/resultado-monitoramento.js';

interface EventoS3 {
  Records?: Array<{ s3?: { bucket?: { name?: string }; object?: { key?: string } } }>;
}

interface ResultadoJson {
  imagem_original: string;
  deteccoes_epi?: DeteccaoBrutaJson[];
  deteccoes_fissura?: DeteccaoBrutaJson[];
  alertas?: { tipo: string; mensagem: string }[];
}

/**
 * Consome `fila-resultados-web` (ver ARQUITETURA_AWS.md): a fila recebe uma
 * mensagem toda vez que o serviço de inferência (fora deste backend, roda
 * numa máquina local do time) termina de processar uma imagem e grava
 * `processed/<nome>.json`. Aqui a gente busca esse JSON, gera a URL
 * pré-assinada da imagem (`processed/<nome>.jpg`) e empurra pro front via
 * SSE — sem gravar nada no banco (decisão de escopo: é feed ao vivo, não
 * vira Deteccao/NaoConformidade).
 *
 * Long polling (`WaitTimeSeconds: 20`) em vez de `@Interval` curto: menos
 * chamada de API à toa, e a AWS já resolve a espera do lado do SQS.
 */
@Injectable()
export class SqsConsumidorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumidorService.name);
  private sqs?: SQSClient;
  private s3?: S3Client;
  private filaUrl?: string;
  private bucket = '';
  private urlTtlSegundos = 300;
  private rodando = false;

  constructor(
    private readonly config: ConfigService,
    private readonly eventos: EventosMonitoramentoService,
  ) {}

  onModuleInit(): void {
    const regiao = this.config.get<string>('monitoramento.regiao') ?? 'sa-east-1';
    this.bucket = this.config.get<string>('monitoramento.bucket') ?? '';
    this.filaUrl = this.config.get<string>('monitoramento.filaResultadosUrl');
    this.urlTtlSegundos = this.config.get<number>('monitoramento.urlTtlSegundos') ?? 300;
    const accessKeyId = this.config.get<string>('monitoramento.accessKeyId');
    const secretAccessKey = this.config.get<string>('monitoramento.secretAccessKey');

    if (!this.filaUrl || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'MONITORAMENTO_AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY ausentes — feed ao vivo de EPI/fissura desligado ' +
          '(o resto da API sobe normalmente). Preencha o .env com a credencial de "web-backend-epis" para ativar.',
      );
      return;
    }

    const credentials = { accessKeyId, secretAccessKey };
    this.sqs = new SQSClient({ region: regiao, credentials });
    this.s3 = new S3Client({ region: regiao, credentials });
    this.rodando = true;
    this.logger.log(`Consumindo fila de resultados de monitoramento (bucket ${this.bucket}).`);
    void this.loop();
  }

  onModuleDestroy(): void {
    this.rodando = false;
  }

  private async loop(): Promise<void> {
    while (this.rodando) {
      try {
        await this.receberUmaLeva();
      } catch (erro) {
        this.logger.error(
          'Falha ao consumir a fila de resultados de monitoramento.',
          erro instanceof Error ? erro.stack : String(erro),
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async receberUmaLeva(): Promise<void> {
    const resposta = await this.sqs!.send(
      new ReceiveMessageCommand({
        QueueUrl: this.filaUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
      }),
    );

    for (const mensagem of resposta.Messages ?? []) {
      await this.processarMensagem(mensagem);
    }
  }

  /**
   * Apaga a mensagem SÓ em caso de sucesso. Em erro, deixa na fila para o
   * SQS reentregar sozinho depois do visibility timeout — pedido explícito
   * de quem desenhou o pipeline (ver prompt_para_backend_web.md): falha
   * transitória (rede, S3 instável) se resolve na próxima tentativa; uma
   * mensagem permanentemente inválida é problema de DLQ na fila, não algo
   * que este consumidor deva decidir apagando por conta própria.
   */
  private async processarMensagem(mensagem: Message): Promise<void> {
    const { Body: corpo, ReceiptHandle: receiptHandle } = mensagem;
    if (!corpo || !receiptHandle) return;

    try {
      const evento = this.extrairEventoS3(corpo);
      if (evento) {
        const resultado = await this.buscarResultado(evento.bucket, evento.chave);
        if (resultado) this.eventos.emitir(resultado);
      }
      await this.sqs!.send(new DeleteMessageCommand({ QueueUrl: this.filaUrl, ReceiptHandle: receiptHandle }));
    } catch (erro) {
      this.logger.warn(
        `Mensagem de resultado mantida na fila para nova tentativa: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  /** A notificação de evento do S3 chega como o envelope padrão `{ Records: [...] }`. */
  private extrairEventoS3(corpo: string): { bucket: string; chave: string } | null {
    const evento = JSON.parse(corpo) as EventoS3;
    const registro = evento.Records?.[0]?.s3;
    const chaveCodificada = registro?.object?.key;
    if (!chaveCodificada) return null;
    return {
      bucket: registro?.bucket?.name ?? this.bucket,
      // Chave do evento S3 vem URL-encoded (espaço vira '+').
      chave: decodeURIComponent(chaveCodificada.replace(/\+/g, ' ')),
    };
  }

  private async buscarResultado(bucket: string, chaveJson: string): Promise<ResultadoMonitoramento | null> {
    if (!chaveJson.endsWith('.json')) return null; // o filtro de sufixo já garante isso, mas não custa checar

    const objeto = await this.s3!.send(new GetObjectCommand({ Bucket: bucket, Key: chaveJson }));
    const texto = await objeto.Body!.transformToString();
    const dados = JSON.parse(texto) as ResultadoJson;

    const chaveImagem = chaveJson.replace(/\.json$/, '.jpg');
    const imagemUrl = await getSignedUrl(this.s3!, new GetObjectCommand({ Bucket: bucket, Key: chaveImagem }), {
      expiresIn: this.urlTtlSegundos,
    });

    return {
      imagemOriginal: dados.imagem_original,
      imagemUrl,
      deteccoesEpi: dados.deteccoes_epi ?? [],
      deteccoesFissura: dados.deteccoes_fissura ?? [],
      alertas: dados.alertas ?? [],
      recebidoEm: new Date().toISOString(),
    };
  }
}
