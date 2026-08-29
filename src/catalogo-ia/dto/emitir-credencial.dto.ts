import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional } from 'class-validator';
import { ESCOPOS_DISPOSITIVO } from '../dominio/escopos-dispositivo.js';

export class EmitirCredencialDto {
  @ApiPropertyOptional({
    enum: ESCOPOS_DISPOSITIVO,
    isArray: true,
    description: 'Omitido = todos os escopos (ingestao de deteccao + heartbeat).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(ESCOPOS_DISPOSITIVO, { each: true })
  escopos?: string[];
}
