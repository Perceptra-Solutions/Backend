import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { StatusCamera } from '../../shared/enums/dominio.enums.js';
import type { Camera } from '../camera.entity.js';

/**
 * Nunca inclui urlStream: a coluna e `select: false` na entidade e mesmo se
 * viesse carregada, cifrada ou nao, nao tem lugar numa resposta de API.
 */
export class CameraResponse {
  @ApiProperty() id!: string;
  @ApiProperty() obraId!: string;
  @ApiPropertyOptional({ nullable: true }) localId!: string | null;
  @ApiPropertyOptional({ nullable: true }) modeloIaId!: string | null;
  @ApiProperty() identificador!: string;
  @ApiPropertyOptional({ nullable: true }) fabricante!: string | null;
  @ApiProperty() protocolo!: string;
  @ApiProperty() status!: StatusCamera;
  @ApiPropertyOptional({ nullable: true }) instaladaEm!: string | null;
  @ApiPropertyOptional({ nullable: true }) ultimoHeartbeat!: Date | null;

  static de(c: Camera): CameraResponse {
    return {
      id: c.id,
      obraId: c.obraId,
      localId: c.localId,
      modeloIaId: c.modeloIaId,
      identificador: c.identificador,
      fabricante: c.fabricante,
      protocolo: c.protocolo,
      status: c.status,
      instaladaEm: c.instaladaEm,
      ultimoHeartbeat: c.ultimoHeartbeat,
    };
  }
}
