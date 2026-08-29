import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PapelUsuario } from '../../shared/enums/dominio.enums.js';

export class CriarUsuarioDto {
  @ApiProperty({ example: 'Ana Ribeiro' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nome!: string;

  @ApiProperty({ example: 'ana@perceptra.dev' })
  @IsEmail()
  // Normaliza na entrada porque a unicidade no banco e por lower(email):
  // sem isto o INSERT falha com 23505 sem que o usuario entenda por que.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'senha-forte-aqui', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres.' })
  @MaxLength(72, { message: 'O bcrypt ignora o que passa de 72 bytes.' })
  senha!: string;

  @ApiProperty({ enum: PapelUsuario })
  @IsEnum(PapelUsuario)
  papel!: PapelUsuario;

  @ApiPropertyOptional({
    example: 'MG-123456/D',
    description: 'Obrigatorio para ENGENHEIRO e proibido para GESTOR.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  crea?: string;
}
