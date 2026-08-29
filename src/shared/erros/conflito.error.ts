import { HttpStatus } from '@nestjs/common';
import { ErroDominio } from './erro-dominio.js';

export class ConflitoError extends ErroDominio {
  readonly codigo: string;
  readonly status = HttpStatus.CONFLICT;

  constructor(codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem, detalhes);
    this.codigo = codigo;
  }
}
