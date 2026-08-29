import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
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

  /**
   * Confere a existencia ANTES de abrir o stream. `createReadStream` falha de
   * forma assincrona, emitindo 'error' — e um ReadStream sem handler de
   * 'error' derruba o processo Node inteiro (unhandled 'error' event), nao so
   * a requisicao.
   *
   * Encontrado de forma independente duas vezes: aqui, com o seed cadastrando
   * linha de evidencia com hash sintetico e sem binario no disco; e num teste
   * contra container, com uma evidencia apontando para arquivo fora do
   * volume — reiniciou a API duas vezes antes de virar este fix.
   *
   * Falhando aqui, o erro vira 404 pelo filtro global, como qualquer outro
   * recurso ausente. O handler em `enviarStream` (usado pelo controller)
   * cobre o resto — o arquivo pode sumir entre esta checagem e a leitura.
   */
  async abrirLeitura(chave: string): Promise<Readable> {
    const caminho = join(this.raiz, chave);
    try {
      await access(caminho);
    } catch {
      throw new RecursoNaoEncontradoError('Arquivo de evidencia', chave);
    }
    return createReadStream(caminho);
  }

  /** Nao ha URL assinada em disco local — quem quiser o arquivo usa /evidencias/:id/integridade ou acesso direto ao volume. */
  async gerarUrlTemporaria(): Promise<null> {
    return null;
  }
}
