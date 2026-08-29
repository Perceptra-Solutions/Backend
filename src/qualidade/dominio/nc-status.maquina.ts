import { StatusNc } from '../../shared/enums/dominio.enums.js';
import { TransicaoInvalidaError } from '../../shared/erros/transicao-invalida.error.js';

/**
 * Maquina de estados da nao conformidade. Funcao pura: sem Nest, sem
 * TypeORM, sem I/O — testavel em milissegundos.
 *
 * Ha um trigger equivalente no banco, mas ele e guarda-costas contra UPDATE
 * direto de seed ou psql. A fonte da verdade e aqui, porque as pre-condicoes
 * reais sao cruzadas (existe acao concluida? existe verificacao aprovada?) e
 * os efeitos colaterais precisam ser transacionais.
 */
export const TRANSICOES: Readonly<Record<StatusNc, readonly StatusNc[]>> = Object.freeze({
  [StatusNc.ABERTA]: [StatusNc.EM_CORRECAO, StatusNc.CANCELADA],
  [StatusNc.EM_CORRECAO]: [StatusNc.AGUARDANDO_VERIFICACAO, StatusNc.CANCELADA],
  // O retorno para EM_CORRECAO e o caminho da verificacao REPROVADA. E a
  // transicao que mais se esquece de modelar, e sem ela a NC reprovada fica
  // presa aguardando uma verificacao que nunca vem.
  [StatusNc.AGUARDANDO_VERIFICACAO]: [
    StatusNc.RESOLVIDA,
    StatusNc.EM_CORRECAO,
    StatusNc.CANCELADA,
  ],
  [StatusNc.RESOLVIDA]: [],
  [StatusNc.CANCELADA]: [],
});

export const ESTADOS_TERMINAIS: readonly StatusNc[] = [StatusNc.RESOLVIDA, StatusNc.CANCELADA];

export function ehTerminal(status: StatusNc): boolean {
  return ESTADOS_TERMINAIS.includes(status);
}

export function podeTransicionar(de: StatusNc, para: StatusNc): boolean {
  // Transicao para o mesmo estado e no-op idempotente, nao erro: um duplo
  // clique no front nao deve virar 422.
  if (de === para) return true;
  return TRANSICOES[de].includes(para);
}

/** Lanca TransicaoInvalidaError quando a transicao nao existe. */
export function exigirTransicaoValida(de: StatusNc, para: StatusNc): void {
  if (!podeTransicionar(de, para)) {
    throw new TransicaoInvalidaError(de, para, TRANSICOES[de]);
  }
}

/**
 * "Atrasada" NAO e status: e derivado do relogio. Coloca-lo no enum
 * misturaria dimensao temporal com dimensao de fluxo e exigiria um job para
 * mudar status a meia-noite.
 */
export function estaAtrasada(
  status: StatusNc,
  prazo: Date | null,
  agora: Date = new Date(),
): boolean {
  if (ehTerminal(status)) return false;
  return prazo !== null && prazo.getTime() < agora.getTime();
}

/**
 * `fechada_em` so existe em estado terminal — e o CHECK ck_nc_fechamento
 * exige exatamente essa correspondencia, nos dois sentidos.
 */
export function fechamentoPara(status: StatusNc, quando: Date): Date | null {
  return ehTerminal(status) ? quando : null;
}
