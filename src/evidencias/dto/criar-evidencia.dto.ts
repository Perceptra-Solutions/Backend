import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Os tres vinculos sao opcionais individualmente, mas o service exige pelo
 * menos um (mesmo invariante do CHECK ck_evidencia_vinculo do banco) — a
 * mensagem do service e mais util que o 409 generico que o banco devolveria.
 */
export class CriarEvidenciaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deteccaoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  naoConformidadeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  acaoCorretivaId?: string;

  @ApiPropertyOptional({ description: 'Hora real da captura. Omitido = agora (hora de recebimento).' })
  @IsOptional()
  @IsISO8601()
  capturadoEm?: string;
}
