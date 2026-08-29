import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { SeveridadeNc, StatusNc } from '../../shared/enums/dominio.enums.js';

/**
 * Estende PaginacaoQuery em vez de conviver com @Query('x') avulsos.
 *
 * Com `whitelist: true, forbidNonWhitelisted: true` o ValidationPipe valida
 * o objeto de query INTEIRO contra um unico DTO: qualquer parametro fora
 * dele vira 422. Misturar `@Query() paginacao` com `@Query('status')` faz o
 * proprio filtro ser rejeitado como campo desconhecido.
 */
export class FiltroNcQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiPropertyOptional({ enum: StatusNc })
  @IsOptional()
  @IsEnum(StatusNc)
  status?: StatusNc;

  @ApiPropertyOptional({ enum: SeveridadeNc })
  @IsOptional()
  @IsEnum(SeveridadeNc)
  severidade?: SeveridadeNc;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsavelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requisitoNormaId?: string;

  @ApiPropertyOptional({ description: 'Somente NCs com prazo vencido e ainda ativas.' })
  @IsOptional()
  // enableImplicitConversion esta desligado de proposito, entao a conversao
  // de 'true'/'false' e explicita aqui.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  atrasadas?: boolean;
}
