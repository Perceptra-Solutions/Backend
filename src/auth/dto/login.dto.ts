import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ana@perceptra.dev' })
  @IsEmail()
  // Mesma normalizacao do cadastro: a unicidade no banco e por lower(email),
  // entao buscar sem normalizar nao acharia o usuario que o indice considera
  // duplicado.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'perceptra123' })
  @IsString()
  @MinLength(1)
  senha!: string;
}
