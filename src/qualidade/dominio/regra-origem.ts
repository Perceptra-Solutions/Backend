import { OrigemRegistro, StatusTriagem } from '../../shared/enums/dominio.enums.js';
import { RegraNegocioError } from '../../shared/erros/regra-negocio.error.js';

/**
 * NC de origem IA nasce de uma deteccao; NC MANUAL nasce de vistoria de
 * campo e nao pode ter deteccao vinculada. O CHECK ck_nc_origem garante no
 * banco; aqui a mensagem explica.
 */
export function exigirCoerenciaDeOrigem(
  origem: OrigemRegistro,
  deteccaoId: string | null | undefined,
): void {
  if (origem === OrigemRegistro.IA && !deteccaoId) {
    throw new RegraNegocioError(
      'ORIGEM_IA_EXIGE_DETECCAO',
      'Nao conformidade de origem IA precisa apontar para a deteccao que a originou.',
    );
  }

  if (origem === OrigemRegistro.MANUAL && deteccaoId) {
    throw new RegraNegocioError(
      'ORIGEM_MANUAL_PROIBE_DETECCAO',
      'Nao conformidade MANUAL nao pode ter deteccao vinculada. Use origem IA para isso.',
    );
  }
}

/**
 * Somente deteccao CONFIRMADA vira NC. Falso positivo e duplicada nunca —
 * senao o indicador de precisao do modelo passa a contar como acerto uma
 * deteccao que o engenheiro descartou.
 */
export function exigirDeteccaoConfirmada(status: StatusTriagem): void {
  if (status === StatusTriagem.CONFIRMADA) return;

  const explicacao: Record<string, string> = {
    [StatusTriagem.PENDENTE]: 'Tri e a deteccao antes de abrir a nao conformidade.',
    [StatusTriagem.FALSO_POSITIVO]: 'Falso positivo nao vira nao conformidade.',
    [StatusTriagem.DUPLICADA]: 'Deteccao duplicada nao vira nao conformidade: use a original.',
  };

  throw new RegraNegocioError(
    'DETECCAO_NAO_CONFIRMADA',
    `Deteccao com triagem ${status} nao pode originar nao conformidade. ${explicacao[status] ?? ''}`.trim(),
    { statusTriagem: status },
  );
}

/**
 * Triagem so sai de PENDENTE, e nunca volta. Retriagem de uma deteccao que
 * ja gerou NC tambem nao: a NC existente ficaria orfa de justificativa.
 */
export function exigirTriagemPermitida(atual: StatusTriagem, novo: StatusTriagem, temNc: boolean): void {
  if (novo === StatusTriagem.PENDENTE) {
    throw new RegraNegocioError(
      'TRIAGEM_NAO_VOLTA_PARA_PENDENTE',
      'Uma deteccao ja triada nao volta para PENDENTE.',
    );
  }

  if (atual !== StatusTriagem.PENDENTE && temNc) {
    throw new RegraNegocioError(
      'DETECCAO_JA_TEM_NC',
      'Esta deteccao ja gerou uma nao conformidade. Cancele a NC antes de retriar.',
    );
  }
}
