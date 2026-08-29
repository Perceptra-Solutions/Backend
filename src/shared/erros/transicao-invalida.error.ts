import { ErroDominio } from './erro-dominio.js';

export class TransicaoInvalidaError extends ErroDominio {
  readonly codigo = 'NC_TRANSICAO_INVALIDA';

  constructor(de: string, para: string, permitidas: readonly string[]) {
    super(
      `Nao conformidade nao pode ir de ${de} para ${para}.` +
        (permitidas.length > 0
          ? ` Transicoes validas a partir de ${de}: ${permitidas.join(', ')}.`
          : ` ${de} e um estado terminal.`),
      { de, para, permitidas },
    );
  }
}
