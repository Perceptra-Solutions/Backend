import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Um evento bruto do agente na borda. `idExterno` e a chave de dedup —
 * sem ela, a camera que ficou horas offline e despeja o buffer ao
 * reconectar conta a mesma deteccao mais de uma vez.
 */
export class ItemDeteccaoDto {
  @ApiProperty({ description: 'Qual VERSAO de modelo produziu esta deteccao.' })
  @IsUUID()
  modeloIaId!: string;

  @ApiPropertyOptional({
    description: 'Id local do agente na borda, para dedup. Omitir desabilita a dedup deste item.',
    example: 'cam07-20260829-000042',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idExterno?: string;

  @ApiProperty({ example: 'TRINCA' })
  @IsString()
  @MaxLength(60)
  classe!: string;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.87 })
  @IsNumber()
  @Min(0)
  @Max(1)
  confianca!: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  bbox?: Record<string, unknown>;

  @ApiProperty({ description: 'Hora do evento NA OBRA (nao a de recebimento).' })
  @IsISO8601()
  ocorridoEm!: string;
}

export class IngerirDeteccoesDto {
  @ApiProperty({ type: () => [ItemDeteccaoDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemDeteccaoDto)
  deteccoes!: ItemDeteccaoDto[];
}
