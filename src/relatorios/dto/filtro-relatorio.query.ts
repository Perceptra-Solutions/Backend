import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { TipoRelatorio } from '../../shared/enums/dominio.enums.js';

/**
 * Um DTO unico para toda a query string. Com `forbidNonWhitelisted`, misturar
 * `@Query()` com `@Query('x')` faz o objeto inteiro ser validado contra o
 * DTO de um dos dois e o outro campo cair como "should not exist".
 */
export class FiltroRelatorioQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiPropertyOptional({ enum: TipoRelatorio })
  @IsOptional()
  @IsEnum(TipoRelatorio)
  tipo?: TipoRelatorio;
}
