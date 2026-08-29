import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, StatusCamera } from '../shared/enums/dominio.enums.js';

@Entity('camera')
@Index('ux_camera_obra_identificador', ['obraId', 'identificador'], { unique: true })
@Index('ix_camera_obra', ['obraId'])
// O DBML manda: url_stream carrega usuario:senha do RTSP e nunca pode ficar
// em texto plano. O envelope e enc:v1:<iv>:<tag>:<ciphertext> (AES-256-GCM).
@Check('ck_camera_stream_cifrado', `url_stream IS NULL OR url_stream LIKE 'enc:v1:%'`)
export class Camera {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'obra_id' })
  obraId!: string;

  @Column({ type: 'uuid', name: 'local_id', nullable: true })
  localId!: string | null;

  @Column({ type: 'uuid', name: 'modelo_ia_id', nullable: true })
  modeloIaId!: string | null;

  @Column({ type: 'text' })
  identificador!: string;

  @Column({ type: 'text', nullable: true })
  fabricante!: string | null;

  /** Cifrada. Nunca entre no select de um repositorio de leitura. */
  @Column({ type: 'text', name: 'url_stream', nullable: true, select: false })
  urlStream!: string | null;

  @Column({ type: 'text', default: 'RTSP' })
  protocolo!: string;

  @Column({
    type: 'enum',
    enum: StatusCamera,
    enumName: NOME_ENUM.statusCamera,
    default: StatusCamera.ATIVA,
  })
  status!: StatusCamera;

  @Column({ type: 'date', name: 'instalada_em', nullable: true })
  instaladaEm!: string | null;

  /** Alimenta o alerta de camera offline. */
  @Column({ type: 'timestamptz', name: 'ultimo_heartbeat', nullable: true })
  ultimoHeartbeat!: Date | null;
}
