import { Controller, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';

import { Publico } from '../auth/decorators/publico.decorator.js';
import { EventosMonitoramentoService } from './eventos-monitoramento.service.js';
import { SseAuthGuard } from './guards/sse-auth.guard.js';

@ApiTags('monitoramento')
@Publico()
@Controller('monitoramento')
export class MonitoramentoController {
  constructor(private readonly eventos: EventosMonitoramentoService) {}

  @Sse('eventos')
  @UseGuards(SseAuthGuard)
  @ApiOperation({
    summary: 'Feed ao vivo de detecções de EPI/fissura (Server-Sent Events)',
    description:
      'Autenticado via query string (`?token=<JWT>`), porque o EventSource do navegador ' +
      'não manda header. Cada evento é um resultado do pipeline AWS (Raspberry Pi -> S3 -> ' +
      'SQS -> inferência -> S3 -> aqui) — ver ARQUITETURA_AWS.md. Sem histórico: quem conectar ' +
      'só vê o que chegar depois de conectado.',
  })
  eventos$(): Observable<MessageEvent> {
    return this.eventos.observar().pipe(map((dado) => ({ data: dado }) as MessageEvent));
  }
}
