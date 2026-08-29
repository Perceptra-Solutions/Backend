import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Sem urlStream aqui: a URL de stream tem rota propria (`PATCH :id/stream`)
 * que cifra antes de gravar. Aceita-la neste DTO abriria caminho para
 * gravar em texto plano por engano.
 */
export class CriarCameraDto {
  @ApiProperty()
  @IsUUID()
  obraId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  localId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  modeloIaId?: string;

  @ApiProperty({ example: 'CAM-07' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  identificador!: string;

  @ApiPropertyOptional({ example: 'Hikvision' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fabricante?: string;

  @ApiPropertyOptional({ example: 'RTSP', default: 'RTSP' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  protocolo?: string;

  @ApiPropertyOptional({ example: '2026-02-01' })
  @IsOptional()
  @IsDateString()
  instaladaEm?: string;
}
