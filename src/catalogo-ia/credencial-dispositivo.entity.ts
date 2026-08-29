import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Identidade da camera Perceptra One perante a API. A camera roda edge e
 * opera OFFLINE — precisa de uma credencial de longa duracao, nao de um
 * login humano.
 *
 * `hash_secreto` e SHA-256(pepper + segredo), nunca o segredo em si: ver
 * `dominio/credencial-dispositivo.util.ts` para geracao e conferencia. O
 * pepper vive so na variavel de ambiente da API — um vazamento deste banco
 * sozinho nao basta para forjar uma credencial.
 *
 * `escopos` restringe o que a credencial pode fazer (hoje: ingestao de
 * deteccao, heartbeat). Uma camera comprometida fisicamente com escopo
 * minimo limita o estrago ao que aquele escopo permite.
 */
@Entity('credencial_dispositivo')
@Index('ix_credencial_camera', ['cameraId'])
@Check('ck_credencial_hash', `hash_secreto ~ '^[0-9a-f]{64}$'`)
export class CredencialDispositivo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'camera_id' })
  cameraId!: string;

  /** Chave de lookup O(1) — indexada UNIQUE, nunca secreta por si so. */
  @Index('ux_credencial_prefixo', { unique: true })
  @Column({ type: 'text' })
  prefixo!: string;

  @Column({ type: 'char', length: 64, name: 'hash_secreto' })
  hashSecreto!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  escopos!: string[];

  @CreateDateColumn({ type: 'timestamptz', name: 'criada_em' })
  criadaEm!: Date;

  @Column({ type: 'timestamptz', name: 'revogada_em', nullable: true })
  revogadaEm!: Date | null;

  @Column({ type: 'timestamptz', name: 'ultimo_uso_em', nullable: true })
  ultimoUsoEm!: Date | null;
}
