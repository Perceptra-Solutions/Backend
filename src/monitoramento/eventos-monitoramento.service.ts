import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { ResultadoMonitoramento } from './dto/resultado-monitoramento.js';

/**
 * Ponte entre o consumidor da fila SQS e quem estiver com a página de
 * monitoramento aberta. `Subject` porque não há replay: quem conectar depois
 * de um evento simplesmente não o vê — é feed ao vivo, não histórico (o
 * histórico de verdade é o `processed/*.json` no S3).
 */
@Injectable()
export class EventosMonitoramentoService {
  private readonly stream = new Subject<ResultadoMonitoramento>();

  emitir(resultado: ResultadoMonitoramento): void {
    this.stream.next(resultado);
  }

  observar(): Observable<ResultadoMonitoramento> {
    return this.stream.asObservable();
  }
}
