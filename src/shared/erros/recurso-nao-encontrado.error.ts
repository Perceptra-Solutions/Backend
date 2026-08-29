import { HttpStatus } from '@nestjs/common';
import { ErroDominio } from './erro-dominio.js';

export class RecursoNaoEncontradoError extends ErroDominio {
  readonly codigo = 'RECURSO_NAO_ENCONTRADO';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(recurso: string, id: string) {
    super(`${recurso} nao encontrado(a): ${id}`, { recurso, id });
  }
}
