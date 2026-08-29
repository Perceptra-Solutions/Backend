import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AtribuirResponsavelDto {
  @ApiProperty({ description: 'Engenheiro ativo que passa a responder pela NC.' })
  @IsUUID()
  responsavelId!: string;
}
