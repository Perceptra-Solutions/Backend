import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Correcao de texto e classificacao. NAO inclui `status`, `codigo`,
 * `severidade` nem `prazo`: status muda por sub-recurso de acao, e codigo e
 * data de abertura sao imutaveis no banco. Com whitelist + forbidNonWhitelisted
 * no ValidationPipe, mandar qualquer um deles devolve 422 em vez de passar.
 */
export class AtualizarNcDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descricao?: string;

  @ApiPropertyOptional({ description: 'Classifica ou reclassifica a NC na norma.' })
  @IsOptional()
  @IsUUID()
  requisitoNormaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  localId?: string;
}
