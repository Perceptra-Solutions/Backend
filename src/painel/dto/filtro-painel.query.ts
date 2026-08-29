import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class FiltroPainelQuery {
  @ApiPropertyOptional({ description: 'Restringe o resumo a uma obra. Omitido = todas as obras.' })
  @IsOptional()
  @IsUUID()
  obraId?: string;
}
