import { OmitType, PartialType } from '@nestjs/swagger';
import { CriarLocalDto } from './criar-local.dto.js';

/** obraId nao muda por aqui: um local nao troca de obra depois de criado. */
export class AtualizarLocalDto extends PartialType(OmitType(CriarLocalDto, ['obraId'] as const)) {}
