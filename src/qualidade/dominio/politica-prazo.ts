import { SeveridadeNc } from '../../shared/enums/dominio.enums.js';

/**
 * SLA por severidade, contado a partir da abertura da NC.
 *
 * Este e o prazo CONTRATUAL, e o unico que alimenta o indicador de atraso.
 * O prazo da acao corretiva e planejamento interno do executor e nao pode
 * ultrapassar este — o MER tem os dois campos com o mesmo nome e sem
 * definir qual manda, e essa ambiguidade se resolve aqui.
 */
export const HORAS_POR_SEVERIDADE: Readonly<Record<SeveridadeNc, number>> = Object.freeze({
  [SeveridadeNc.CRITICA]: 24,
  [SeveridadeNc.ALTA]: 72,
  [SeveridadeNc.MEDIA]: 24 * 7,
  [SeveridadeNc.BAIXA]: 24 * 15,
});

export function calcularPrazo(severidade: SeveridadeNc, abertaEm: Date): Date {
  return new Date(abertaEm.getTime() + HORAS_POR_SEVERIDADE[severidade] * 3_600_000);
}

/**
 * O prazo NAO e recalculado quando a NC volta de uma verificacao reprovada:
 * o SLA continua contado desde a abertura. E o comportamento correto — a
 * obra nao ganha tempo extra por ter feito a correcao errada — e e
 * exatamente o que o painel precisa medir.
 */
export function prazoAposReprovacao(prazoAtual: Date | null): Date | null {
  return prazoAtual;
}

/** O prazo operacional da acao nao pode ultrapassar o SLA da NC. */
export function prazoDaAcaoEhValido(prazoAcao: Date | null, prazoNc: Date | null): boolean {
  if (prazoAcao === null || prazoNc === null) return true;
  return prazoAcao.getTime() <= prazoNc.getTime();
}
