import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Um trigger no banco (`trg_modelo_ia_imutavel`) bloqueia UPDATE de qualquer
 * coluna que nao seja `ativo` ou `limiar_confianca` — versao publicada e
 * imutavel, cada versao nova e uma linha nova. Este DTO so expoe o que o
 * trigger permite; qualquer outro campo aqui so geraria um 0A000 (`REGISTRO_IMUTAVEL`).
 */
export class AtualizarModeloIaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  limiarConfianca?: number;
}
