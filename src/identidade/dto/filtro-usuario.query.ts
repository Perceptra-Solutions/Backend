import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { PapelUsuario } from '../../shared/enums/dominio.enums.js';

export class FiltroUsuarioQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: PapelUsuario })
  @IsOptional()
  @IsEnum(PapelUsuario)
  papel?: PapelUsuario;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ativo?: boolean;
}
