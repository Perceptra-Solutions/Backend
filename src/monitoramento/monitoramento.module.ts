import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EventosMonitoramentoService } from './eventos-monitoramento.service.js';
import { SseAuthGuard } from './guards/sse-auth.guard.js';
import { MonitoramentoController } from './monitoramento.controller.js';
import { SqsConsumidorService } from './sqs-consumidor.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MonitoramentoController],
  providers: [EventosMonitoramentoService, SqsConsumidorService, SseAuthGuard],
})
export class MonitoramentoModule {}
