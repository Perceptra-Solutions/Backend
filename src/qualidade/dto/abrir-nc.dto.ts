import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SeveridadeNc } from '../../shared/enums/dominio.enums.js';

/** Base comum entre a NC manual e a que nasce de uma deteccao. */
class DadosNcBase {
  @ApiProperty({ example: 'Infiltracao no piso do banheiro 703' })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  titulo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descricao?: string;

  @ApiProperty({ enum: SeveridadeNc, description: 'Define o prazo: CRITICA 24h, ALTA 72h, MEDIA 7d, BAIXA 15d.' })
  @IsEnum(SeveridadeNc)
  severidade!: SeveridadeNc;

  @ApiPropertyOptional({ description: 'Requisito da NBR 15575 ou do PBQP-H que a NC viola.' })
  @IsOptional()
  @IsUUID()
  requisitoNormaId?: string;

  @ApiPropertyOptional({ description: 'Engenheiro responsavel pela NC.' })
  @IsOptional()
  @IsUUID()
  responsavelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  localId?: string;

  @ApiPropertyOptional({ description: 'NC anterior da qual esta e reincidencia.' })
  @IsOptional()
  @IsUUID()
  reincidenciaDeId?: string;
}

/** NC de vistoria de campo, sem camera. */
export class AbrirNcManualDto extends DadosNcBase {
  @ApiProperty({ description: 'Obra da NC.' })
  @IsUUID()
  obraId!: string;
}

/**
 * NC que nasce de uma deteccao confirmada. A obra vem da propria deteccao —
 * aceitar do cliente abriria espaco para NC gravada na obra errada.
 */
export class AbrirNcDeDeteccaoDto extends DadosNcBase {}
