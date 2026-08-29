import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { TipoEvidencia } from '../../shared/enums/dominio.enums.js';

export class FiltroEvidenciaQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deteccaoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  naoConformidadeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  acaoCorretivaId?: string;

  @ApiPropertyOptional({ enum: TipoEvidencia })
  @IsOptional()
  @IsEnum(TipoEvidencia)
  tipo?: TipoEvidencia;
}
