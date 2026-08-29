import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { lerRequestId } from '../middlewares/request-id.middleware.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    if (contexto.getType() !== 'http') return proximo.handle();

    const req = contexto.switchToHttp().getRequest<Request>();
    const res = contexto.switchToHttp().getResponse<Response>();
    const inicio = performance.now();

    const registrar = (status: number) => {
      const ms = Math.round(performance.now() - inicio);
      const usuarioId = (req as Request & { usuario?: { id: string } }).usuario?.id ?? '-';
      this.logger.log(
        `${req.method} ${req.originalUrl} ${status} ${ms}ms usuario=${usuarioId} req=${lerRequestId(req)}`,
      );
    };

    return proximo.handle().pipe(
      tap({
        next: () => registrar(res.statusCode),
        // O filtro global ja definiu o status quando o erro chega aqui.
        error: (erro: { status?: number }) => registrar(erro?.status ?? 500),
      }),
    );
  }
}
