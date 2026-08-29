import { PartialType } from '@nestjs/swagger';
import { CriarRequisitoNormaDto } from './criar-requisito-norma.dto.js';

export class AtualizarRequisitoNormaDto extends PartialType(CriarRequisitoNormaDto) {}
