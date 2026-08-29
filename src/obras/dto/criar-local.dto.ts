import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TipoLocal } from '../../shared/enums/dominio.enums.js';

export class CriarLocalDto {
  @ApiProperty()
  @IsUUID()
  obraId!: string;

  @ApiProperty({ enum: TipoLocal })
  @IsEnum(TipoLocal)
  tipo!: TipoLocal;

  @ApiProperty({ example: 'Torre B / 7 pav / apto 703' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nome!: string;

  @ApiPropertyOptional({ example: 'B-07-703' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  codigo?: string;
}
