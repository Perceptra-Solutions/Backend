import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArmazenamentoPort } from './armazenamento.port.js';

/**
 * S3 / Cloudflare R2 (a config aceita `S3_ENDPOINT` custom para R2;
 * `forcePathStyle` e exigido por R2 e por qualquer S3-compativel que nao
 * seja o S3 real).
 */
@Injectable()
export class ArmazenamentoS3 extends ArmazenamentoPort {
  private readonly cliente: S3Client;
  private readonly bucket: string;
  private readonly ttlSegundos: number;

  constructor(config: ConfigService) {
    super();
    const endpoint = config.get<string>('evidencia.s3.endpoint');

    this.cliente = new S3Client({
      region: config.getOrThrow<string>('evidencia.s3.region'),
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: {
        accessKeyId: config.getOrThrow<string>('evidencia.s3.accessKeyId'),
        secretAccessKey: config.getOrThrow<string>('evidencia.s3.secretAccessKey'),
      },
    });
    this.bucket = config.getOrThrow<string>('evidencia.s3.bucket');
    this.ttlSegundos = config.getOrThrow<number>('evidencia.s3.urlTtlSegundos');
  }

  async salvar(chave: string, caminhoOrigem: string, contentType: string): Promise<void> {
    // ContentLength explicito: sem ele, o SDK precisaria ler o stream inteiro
    // na memoria antes de assinar a requisicao — ruim para video de 200MB.
    const { size } = await stat(caminhoOrigem);

    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: createReadStream(caminhoOrigem),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async abrirLeitura(chave: string): Promise<Readable> {
    const resposta = await this.cliente.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
    );
    // O SDK v3 tipa Body como um uniao (stream Node | Blob | ReadableStream web)
    // porque o mesmo client roda em browser; no runtime Node ele e sempre
    // um Readable de node:stream.
    return resposta.Body as Readable;
  }

  async gerarUrlTemporaria(chave: string): Promise<string> {
    return getSignedUrl(this.cliente, new GetObjectCommand({ Bucket: this.bucket, Key: chave }), {
      expiresIn: this.ttlSegundos,
    });
  }
}
