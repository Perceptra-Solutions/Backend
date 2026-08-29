import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArmazenamentoPort } from './armazenamento.port.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';

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

  /**
   * Confere a existencia ANTES de devolver o stream.
   *
   * Sem isto, `createReadStream` de um caminho inexistente devolve um stream
   * que so falha depois — e como o controller ja fez `.pipe(res)`, o
   * 'error' sai sem ouvinte e o Node DERRUBA O PROCESSO
   * (`Unhandled 'error' event`). Aconteceu de verdade: uma linha de evidencia
   * apontando para arquivo que nao estava no volume do container reiniciou a
   * API duas vezes. Agora vira 404, que e a resposta correta.
   */
  async abrirLeitura(chave: string): Promise<Readable> {
    const caminho = join(this.raiz, chave);
    try {
      await access(caminho);
    } catch {
      throw new RecursoNaoEncontradoError('Arquivo no storage', chave);
    }
    return createReadStream(caminho);
  }

  /** Nao ha URL assinada em disco local — quem quiser o arquivo usa /evidencias/:id/integridade ou acesso direto ao volume. */
  async gerarUrlTemporaria(): Promise<null> {
    return null;
  }
}
