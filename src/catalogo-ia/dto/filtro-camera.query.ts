import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { StatusCamera } from '../../shared/enums/dominio.enums.js';

export class FiltroCameraQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  localId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  modeloIaId?: string;

  @ApiPropertyOptional({ enum: StatusCamera })
  @IsOptional()
  @IsEnum(StatusCamera)
  status?: StatusCamera;
}
