import { createReadStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArmazenamentoPort } from './armazenamento.port.js';

/**
 * Fallback em disco, para rodar a demo sem nuvem (`EVIDENCIA_STORAGE_DRIVER=local`).
 * `chave` e sempre relativa (`evidencias/ab/cd/<hash>.jpg`) — nunca um
 * caminho absoluto: junta com `localPath` aqui dentro, nunca antes.
 */
@Injectable()
export class ArmazenamentoLocal extends ArmazenamentoPort {
  private readonly raiz: string;

  constructor(config: ConfigService) {
    super();
    this.raiz = config.getOrThrow<string>('evidencia.localPath');
  }

  async salvar(chave: string, caminhoOrigem: string): Promise<void> {
    const destino = join(this.raiz, chave);
    await mkdir(dirname(destino), { recursive: true });
    await copyFile(caminhoOrigem, destino);
  }

  async abrirLeitura(chave: string): Promise<Readable> {
    return createReadStream(join(this.raiz, chave));
  }

  /** Nao ha URL assinada em disco local — quem quiser o arquivo usa /evidencias/:id/integridade ou acesso direto ao volume. */
  async gerarUrlTemporaria(): Promise<null> {
    return null;
  }
}
