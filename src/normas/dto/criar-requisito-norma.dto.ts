import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CategoriaDesempenho } from '../../shared/enums/dominio.enums.js';

export class CriarRequisitoNormaDto {
  @ApiProperty({ example: 'NBR 15575' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  norma!: string;

  @ApiProperty({ example: 'Parte 3 - 11.2' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  item!: string;

  @ApiProperty({ enum: CategoriaDesempenho })
  @IsEnum(CategoriaDesempenho)
  categoria!: CategoriaDesempenho;

  @ApiProperty({ example: 'Estanqueidade de fachadas e coberturas' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  descricao!: string;
}
