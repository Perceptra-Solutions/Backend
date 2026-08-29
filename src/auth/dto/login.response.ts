import { ApiProperty } from '@nestjs/swagger';
import type { PapelUsuario } from '../../shared/enums/dominio.enums.js';

export class UsuarioDoTokenResponse {
  @ApiProperty() id!: string;
  @ApiProperty() nome!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['GESTOR', 'ENGENHEIRO'] }) papel!: PapelUsuario;
  @ApiProperty({ nullable: true }) crea!: string | null;
}

export class LoginResponse {
  @ApiProperty({ description: 'JWT Bearer' })
  acessoToken!: string;

  @ApiProperty({ example: '1d' })
  expiraEm!: string;

  @ApiProperty({ type: () => UsuarioDoTokenResponse })
  usuario!: UsuarioDoTokenResponse;
}
