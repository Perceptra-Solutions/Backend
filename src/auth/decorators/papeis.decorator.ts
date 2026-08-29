import { SetMetadata } from '@nestjs/common';
import type { PapelUsuario } from '../../shared/enums/dominio.enums.js';

export const CHAVE_PAPEIS = 'papeis_exigidos';

/**
 * Restringe a rota a determinados papeis.
 *
 * Cuidado com o limite deste decorator: ele decide por PAPEL. A segregacao
 * de funcao ("engenheiro diferente do executor") decide por IDENTIDADE e
 * depende de dados carregados — mora no dominio, nao aqui. Confundir os
 * dois e o erro classico neste projeto.
 */
export const Papeis = (...papeis: PapelUsuario[]) => SetMetadata(CHAVE_PAPEIS, papeis);
