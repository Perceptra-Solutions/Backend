import { SegregacaoFuncaoError } from '../../shared/erros/segregacao-funcao.error.js';

/**
 * O invariante que define o desafio: quem executou a acao corretiva nao pode
 * verifica-la.
 *
 * Existe em duas camadas de proposito. O trigger no banco garante que nem um
 * INSERT direto burla; esta funcao garante que o usuario recebe 422 com uma
 * mensagem util em vez de um 23514 cru.
 *
 * Note que isto NAO cabe num guard de papel: o guard decide por papel
 * (ENGENHEIRO), enquanto aqui a decisao e por identidade e depende de dados
 * ja carregados (o executor da acao).
 */
export function podeVerificar(executorId: string, verificadorId: string): boolean {
  return executorId !== verificadorId;
}

export function exigirSegregacaoDeFuncao(executorId: string, verificadorId: string): void {
  if (!podeVerificar(executorId, verificadorId)) {
    throw new SegregacaoFuncaoError(verificadorId);
  }
}
