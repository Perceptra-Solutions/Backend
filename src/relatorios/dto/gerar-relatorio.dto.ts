import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

import { SeveridadeNc, StatusNc, TipoRelatorio } from '../../shared/enums/dominio.enums.js';

/**
 * O relatorio e um SNAPSHOT: os filtros abaixo escolhem quais NCs entram no
 * documento no momento da geracao, e o vinculo fica gravado em
 * `relatorio_item`. Reprocessar depois nao muda um relatorio ja emitido —
 * e essa imutabilidade que o torna util numa auditoria.
 */
export class GerarRelatorioDto {
  @ApiProperty()
  @IsUUID()
  obraId!: string;

  @ApiProperty({ enum: TipoRelatorio })
  @IsEnum(TipoRelatorio)
  tipo!: TipoRelatorio;

  @ApiPropertyOptional({ description: 'Omitido = gerado a partir do tipo, da obra e do periodo.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;

  // O CHECK ck_relatorio_periodico_exige_periodo ja garante isto no banco;
  // validar aqui devolve 422 com o campo, em vez de 409 generico do Postgres.
  @ApiPropertyOptional({ description: 'AAAA-MM-DD. Obrigatorio quando tipo=PERIODICO.' })
  @ValidateIf((dto: GerarRelatorioDto) => dto.tipo === TipoRelatorio.PERIODICO || dto.periodoFim !== undefined)
  @IsISO8601()
  periodoInicio?: string;

  @ApiPropertyOptional({ description: 'AAAA-MM-DD. Obrigatorio quando tipo=PERIODICO.' })
  @ValidateIf((dto: GerarRelatorioDto) => dto.tipo === TipoRelatorio.PERIODICO || dto.periodoInicio !== undefined)
  @IsISO8601()
  periodoFim?: string;

  @ApiPropertyOptional({
    enum: SeveridadeNc,
    isArray: true,
    description: 'Omitido = todas as severidades.',
  })
  @IsOptional()
  @IsEnum(SeveridadeNc, { each: true })
  severidades?: SeveridadeNc[];

  @ApiPropertyOptional({
    enum: StatusNc,
    isArray: true,
    description: 'Omitido = todos os status, inclusive os terminais.',
  })
  @IsOptional()
  @IsEnum(StatusNc, { each: true })
  statuses?: StatusNc[];
}
