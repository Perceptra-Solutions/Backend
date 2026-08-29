import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { CategoriaDesempenho } from '../../shared/enums/dominio.enums.js';

export class FiltroRequisitoNormaQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: CategoriaDesempenho })
  @IsOptional()
  @IsEnum(CategoriaDesempenho)
  categoria?: CategoriaDesempenho;

  @ApiPropertyOptional({ example: 'NBR 15575' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  norma?: string;
}
