import { ErroDominio } from './erro-dominio.js';

/**
 * Erro de regra de negocio generico, para invariantes que nao merecem
 * uma classe propria. Sempre passe um codigo estavel.
 */
export class RegraNegocioError extends ErroDominio {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem, detalhes);
    this.codigo = codigo;
  }
}
