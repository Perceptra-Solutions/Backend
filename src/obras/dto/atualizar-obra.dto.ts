import { PartialType } from '@nestjs/swagger';
import { CriarObraDto } from './criar-obra.dto.js';

export class AtualizarObraDto extends PartialType(CriarObraDto) {}
