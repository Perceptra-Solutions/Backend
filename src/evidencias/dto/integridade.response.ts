import { ApiProperty } from '@nestjs/swagger';

export class IntegridadeResponse {
  @ApiProperty({ description: 'true = o conteudo no storage bate com o hash gravado na criacao.' })
  integra!: boolean;

  @ApiProperty({ example: 'a'.repeat(64) })
  hashArmazenado!: string;

  @ApiProperty({ example: 'a'.repeat(64) })
  hashRecalculado!: string;
}
