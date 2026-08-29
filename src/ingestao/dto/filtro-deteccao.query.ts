import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginacaoQuery } from '../../shared/dto/paginacao.query.js';
import { StatusTriagem } from '../../shared/enums/dominio.enums.js';

export class FiltroDeteccaoQuery extends PaginacaoQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cameraId?: string;

  @ApiPropertyOptional({
    enum: StatusTriagem,
    description: 'Use PENDENTE para a fila de trabalho do engenheiro.',
  })
  @IsOptional()
  @IsEnum(StatusTriagem)
  statusTriagem?: StatusTriagem;

  @ApiPropertyOptional({ example: 'TRINCA' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  classe?: string;
}
