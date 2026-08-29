import type { ValueTransformer } from 'typeorm';

/**
 * O driver pg devolve `numeric` como string, de proposito: um numeric(38,10)
 * nao cabe num double do JS. Nas nossas colunas (confianca 0..1 com 3 casas,
 * custo com 2) a perda nao existe, e trabalhar com string contamina todo
 * calculo do painel. Este transformer converte na borda.
 */
export const numericoTransformer: ValueTransformer = {
  to: (valor: number | null | undefined) => valor ?? null,
  from: (valor: string | null): number | null => (valor === null ? null : Number(valor)),
};
