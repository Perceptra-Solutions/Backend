import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PapelUsuario } from '../../shared/enums/dominio.enums.js';
import type { Usuario } from '../usuario.entity.js';

/**
 * A defesa real contra vazar senha_hash e o `select: false` na entidade mais
 * este mapeamento explicito — e nao o ClassSerializerInterceptor, que so age
 * sobre instancias de classe e nao veria um objeto literal do TypeORM.
 */
export class UsuarioResponse {
  @ApiProperty() id!: string;
  @ApiProperty() nome!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['GESTOR', 'ENGENHEIRO'] }) papel!: PapelUsuario;
  @ApiPropertyOptional({ nullable: true }) crea!: string | null;
  @ApiProperty() ativo!: boolean;
  @ApiProperty() criadoEm!: Date;

  static de(u: Usuario): UsuarioResponse {
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel,
      crea: u.crea,
      ativo: u.ativo,
      criadoEm: u.criadoEm,
    };
  }
}
