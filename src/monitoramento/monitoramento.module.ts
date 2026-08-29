import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { Camera } from '../catalogo-ia/camera.entity.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Evidencia } from '../evidencias/evidencia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { Obra } from '../obras/obra.entity.js';
import { EventosMonitoramentoService } from './eventos-monitoramento.service.js';
import { SseAuthGuard } from './guards/sse-auth.guard.js';
import { MonitoramentoController } from './monitoramento.controller.js';
import { PersistenciaDeteccaoService } from './persistencia-deteccao.service.js';
import { SqsConsumidorService } from './sqs-consumidor.service.js';

/**
 * TypeOrmModule.forFeature aqui (não em CatalogoIaModule/IngestaoModule):
 * mesmo padrão do resto do projeto — quem precisa do DADO registra o
 * próprio forFeature (ver comentário em DispositivoModule). Este módulo
 * grava Deteccao+Evidencia diretas (bypassa DispositivoService de
 * propósito: aquele serviço tem regras de dispositivo de borda não confiável
 * — janela de tempo, MODELO_NAO_ENCONTRADO — que não se aplicam aqui, o
 * produtor é o próprio pipeline interno, já confiável).
 */
@Module({
  imports: [
    AuthModule,
    ArmazenamentoModule,
    TypeOrmModule.forFeature([Deteccao, Evidencia, Camera, ModeloIa, Obra]),
  ],
  controllers: [MonitoramentoController],
  providers: [EventosMonitoramentoService, SqsConsumidorService, SseAuthGuard, PersistenciaDeteccaoService],
})
export class MonitoramentoModule {}
