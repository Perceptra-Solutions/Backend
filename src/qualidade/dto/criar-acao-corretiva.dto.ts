import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CriarAcaoCorretivaDto {
  @ApiProperty({ description: 'Engenheiro ativo que vai executar a correcao.' })
  @IsUUID()
  executorId!: string;

  @ApiProperty({ example: 'Remocao do contrapiso e reaplicacao de manta asfaltica' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  descricao!: string;

  @ApiPropertyOptional({ example: 'Falha na sobreposicao da manta junto ao ralo' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  causaRaiz?: string;

  @ApiPropertyOptional({
    example: '2026-09-05',
    description: 'Planejamento do executor. Nao pode ultrapassar o prazo (SLA) da NC.',
  })
  @IsOptional()
  @IsDateString()
  prazo?: string;

  @ApiPropertyOptional({ example: 2350.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  custo?: number;
}
