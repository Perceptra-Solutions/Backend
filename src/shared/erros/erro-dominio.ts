import { HttpStatus } from '@nestjs/common';

/**
 * Base de todo erro de negocio. O `codigo` e SCREAMING_SNAKE e estavel:
 * e nele que o front chaveia. A `mensagem` e para humanos e pode mudar
 * sem quebrar cliente.
 */
export abstract class ErroDominio extends Error {
  abstract readonly codigo: string;
  readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY;
  readonly detalhes?: unknown;

  constructor(mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = new.target.name;
    this.detalhes = detalhes;
  }
}
