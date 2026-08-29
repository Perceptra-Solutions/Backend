import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DetalheErroDto {
  @ApiProperty({ example: 'severidade' })
  campo!: string;

  @ApiProperty({ example: ['severidade deve ser um de: BAIXA, MEDIA, ALTA, CRITICA'] })
  restricoes!: string[];
}

export class CorpoErroDto {
  @ApiProperty({
    example: 'NC_TRANSICAO_INVALIDA',
    description:
      'Codigo estavel em SCREAMING_SNAKE. E nele que o cliente deve chavear — a mensagem pode mudar.',
  })
  codigo!: string;

  @ApiProperty({ example: 'Nao conformidade nao pode ir de RESOLVIDA para EM_CORRECAO.' })
  mensagem!: string;

  @ApiPropertyOptional({ type: () => [DetalheErroDto] })
  detalhes?: unknown;

  @ApiProperty({ example: '0f8b1e3a-4c2d-4f1a-9a7b-1c2d3e4f5a6b' })
  requestId!: string;

  @ApiProperty({ example: '2026-08-28T18:20:11.412Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/nao-conformidades/123' })
  caminho!: string;
}

export class RespostaErroDto {
  @ApiProperty({ type: () => CorpoErroDto })
  erro!: CorpoErroDto;
}
