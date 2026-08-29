import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StatusCamera } from '../shared/enums/dominio.enums.js';
import { Camera } from './camera.entity.js';

/**
 * Marca OFFLINE a camera que parou de mandar heartbeat. So mexe em camera
 * ATIVA com heartbeat registrado — uma camera que nunca mandou heartbeat
 * (`ultimo_heartbeat IS NULL`, ainda nao configurada) fica fora, de proposito:
 * `NULL < now() - interval` e NULL em SQL, nunca verdadeiro.
 */
@Injectable()
export class CameraHeartbeatScheduler {
  private readonly logger = new Logger(CameraHeartbeatScheduler.name);

  constructor(
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    private readonly config: ConfigService,
  ) {}

  @Interval(30_000)
  async marcarCamerasSemHeartbeatComoOffline(): Promise<void> {
    const timeoutSegundos = this.config.getOrThrow<number>('camera.heartbeatTimeoutSegundos');

    const resultado = await this.cameras
      .createQueryBuilder()
      .update(Camera)
      .set({ status: StatusCamera.OFFLINE })
      .where('status = :ativa', { ativa: StatusCamera.ATIVA })
      .andWhere(`ultimo_heartbeat < now() - make_interval(secs => :timeout)`, {
        timeout: timeoutSegundos,
      })
      .execute();

    const marcadas = resultado.affected ?? 0;
    if (marcadas > 0) {
      this.logger.warn(`${marcadas} camera(s) marcada(s) OFFLINE por falta de heartbeat.`);
    }
  }
}
