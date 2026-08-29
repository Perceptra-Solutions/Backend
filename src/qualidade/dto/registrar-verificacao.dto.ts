import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ResultadoVerificacao } from '../../shared/enums/dominio.enums.js';

export class RegistrarVerificacaoDto {
  @ApiProperty({ enum: ResultadoVerificacao })
  @IsEnum(ResultadoVerificacao)
  resultado!: ResultadoVerificacao;

  @ApiPropertyOptional({
    example: 'Teste de estanqueidade de 72h sem vazamento. Conforme NBR 15575-3.',
    description: 'Obrigatorio quando REPROVADA: o executor precisa saber o que falta.',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  parecer?: string;
}
