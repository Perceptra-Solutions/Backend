import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { StatusTriagem } from '../../shared/enums/dominio.enums.js';

/**
 * Descarte de deteccao. CONFIRMADA nao aparece aqui: confirmar e abrir a NC
 * sao o mesmo ato e acontecem em POST /deteccoes/:id/nao-conformidades.
 */
export enum ResultadoDescarte {
  FALSO_POSITIVO = StatusTriagem.FALSO_POSITIVO,
  DUPLICADA = StatusTriagem.DUPLICADA,
}

export class TriarDeteccaoDto {
  @ApiProperty({ enum: ResultadoDescarte })
  @IsEnum(ResultadoDescarte)
  resultado!: ResultadoDescarte;

  @ApiPropertyOptional({
    description: 'Obrigatorio quando DUPLICADA: qual deteccao e a original.',
  })
  @IsOptional()
  @IsUUID()
  duplicadaDeId?: string;
}
