import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { TipoLocal } from '../../shared/enums/dominio.enums.js';

export class FiltroLocalQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiPropertyOptional({ enum: TipoLocal })
  @IsOptional()
  @IsEnum(TipoLocal)
  tipo?: TipoLocal;
}
