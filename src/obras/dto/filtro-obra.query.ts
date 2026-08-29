import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { StatusObra } from '../../shared/enums/dominio.enums.js';

export class FiltroObraQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: StatusObra })
  @IsOptional()
  @IsEnum(StatusObra)
  status?: StatusObra;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  uf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsavelTecnicoId?: string;
}
