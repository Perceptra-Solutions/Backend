import { SetMetadata } from '@nestjs/common';

export const CHAVE_PUBLICO = 'rota_publica';

/**
 * O JwtAuthGuard e global (APP_GUARD): tudo exige token por padrao, e a
 * rota que nao exige precisa dizer. O contrario — proteger rota a rota —
 * falha por omissao, que e o pior modo de falha em autorizacao.
 */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true);
