import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CriarModeloIaDto {
  @ApiProperty({ example: 'trinca-fachada' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nome!: string;

  @ApiProperty({ example: 'v1.2.0' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  versao!: string;

  @ApiProperty({ example: 'TRINCA', description: 'TRINCA | INFILTRACAO | EPI | ORGANIZACAO ...' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  tipoDeteccao!: string;

  @ApiPropertyOptional({ example: 0.7, minimum: 0, maximum: 1, default: 0.7 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  limiarConfianca?: number;

  @ApiPropertyOptional({ description: 'precision / recall / mAP do treino' })
  @IsOptional()
  @IsObject()
  metricas?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  hashArtefato?: string;
}
