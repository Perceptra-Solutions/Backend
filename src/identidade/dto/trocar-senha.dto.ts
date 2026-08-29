import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class TrocarSenhaDto {
  @ApiProperty()
  @IsString()
  senhaAtual!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  senhaNova!: string;
}
