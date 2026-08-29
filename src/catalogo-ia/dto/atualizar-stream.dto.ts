import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AtualizarStreamDto {
  @ApiProperty({
    example: 'rtsp://admin:senha-forte@10.0.0.5:554/stream1',
    description: 'Texto plano — a API cifra (AES-256-GCM) antes de gravar. Nunca fica em claro no banco.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  urlStream!: string;
}
