import { ErroDominio } from './erro-dominio.js';

/**
 * O invariante que da nome ao desafio: quem executou a acao corretiva
 * nao pode verifica-la. Tambem existe como TRIGGER no banco — este erro
 * e o que devolve uma mensagem util em vez de um 23514 cru.
 */
export class SegregacaoFuncaoError extends ErroDominio {
  readonly codigo = 'SEGREGACAO_FUNCAO_VIOLADA';

  constructor(usuarioId: string) {
    super(
      'Quem executou a acao corretiva nao pode verifica-la. ' +
        'A verificacao precisa ser feita por outro engenheiro.',
      { usuarioId },
    );
  }
}
