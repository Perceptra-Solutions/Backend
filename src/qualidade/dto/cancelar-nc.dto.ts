import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelarNcDto {
  @ApiProperty({
    example: 'Duplicada da NC-2026-000004, aberta pela mesma trinca.',
    description:
      'Obrigatorio. Cancelar e a rota mais facil para maquiar indicador, ' +
      'entao precisa ser justificado e fica no historico.',
  })
  @IsString()
  @MinLength(10, { message: 'Justifique o cancelamento com ao menos 10 caracteres.' })
  @MaxLength(1000)
  motivo!: string;
}
