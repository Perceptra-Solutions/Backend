import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CameraController } from './camera.controller.js';
import { Camera } from './camera.entity.js';
import { CameraHeartbeatScheduler } from './camera-heartbeat.scheduler.js';
import { CameraService } from './camera.service.js';
import { CredencialDispositivo } from './credencial-dispositivo.entity.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import { ModeloIaController } from './modelo-ia.controller.js';
import { ModeloIa } from './modelo-ia.entity.js';
import { ModeloIaService } from './modelo-ia.service.js';

/**
 * Exporta ApiKeyGuard: e o comportamento que o DispositivoModule precisa
 * para proteger `/dispositivo/*`. Nao exporta os repositorios — quem
 * precisar do DADO (nao do comportamento) registra o proprio forFeature,
 * como IngestaoModule ja faz com NaoConformidade.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Camera, CredencialDispositivo, ModeloIa])],
  controllers: [CameraController, ModeloIaController],
  providers: [CameraService, ApiKeyGuard, CameraHeartbeatScheduler, ModeloIaService],
  exports: [ApiKeyGuard],
})
export class CatalogoIaModule {}
