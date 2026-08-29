import { ApiProperty } from '@nestjs/swagger';

export class CredencialEmitidaResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6' })
  prefixo!: string;

  @ApiProperty({
    example: 'pcr_a1b2c3d4e5f6_9f8e7d6c5b4a...',
    description:
      'O token completo. Mostrado UMA UNICA VEZ — o servidor guarda so o hash. ' +
      'Se for perdido, a unica saida e revogar e emitir outra credencial.',
  })
  chave!: string;

  @ApiProperty({ isArray: true, type: String })
  escopos!: string[];

  @ApiProperty()
  criadaEm!: Date;
}
