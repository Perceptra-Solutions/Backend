import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StatusObra } from '../../shared/enums/dominio.enums.js';

export class CriarObraDto {
  @ApiProperty({ example: 'OBRA-001' })
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  codigo!: string;

  @ApiProperty({ example: 'Residencial Jardim das Flores' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nome!: string;

  @ApiPropertyOptional({ example: 'Rua das Palmeiras, 123' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  endereco?: string;

  @ApiPropertyOptional({ example: 'Belo Horizonte' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  cidade?: string;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'UF precisa ser a sigla de duas letras do estado.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  uf?: string;

  @ApiPropertyOptional({ enum: StatusObra, default: StatusObra.EM_ANDAMENTO })
  @IsOptional()
  @IsEnum(StatusObra)
  status?: StatusObra;

  @ApiPropertyOptional({ description: 'Id do usuario ENGENHEIRO responsavel tecnico.' })
  @IsOptional()
  @IsUUID()
  responsavelTecnicoId?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  inicioPrevisto?: string;

  @ApiPropertyOptional({ example: '2026-12-20' })
  @IsOptional()
  @IsDateString()
  fimPrevisto?: string;
}
