import { ErroDominio } from './erro-dominio.js';

/**
 * Falha de validacao de DTO. Existe para que a validacao use o MESMO
 * envelope de erro do resto da API — um contrato de erro so, nao dois.
 */
export class ErroValidacaoError extends ErroDominio {
  readonly codigo = 'VALIDACAO_FALHOU';

  constructor(detalhes: { campo: string; restricoes: string[] }[]) {
    super('Os dados enviados sao invalidos.', detalhes);
  }
}
