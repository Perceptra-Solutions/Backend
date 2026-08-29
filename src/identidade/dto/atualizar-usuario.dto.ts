import { PartialType, OmitType } from '@nestjs/swagger';
import { CriarUsuarioDto } from './criar-usuario.dto.js';

/**
 * Papel e senha nao mudam por aqui: trocar papel muda autorizacao e trocar
 * senha tem rota propria (que exige a senha atual). Deixa-los editaveis num
 * PATCH generico seria escalonamento de privilegio de graca.
 */
export class AtualizarUsuarioDto extends PartialType(
  OmitType(CriarUsuarioDto, ['papel', 'senha'] as const),
) {}
