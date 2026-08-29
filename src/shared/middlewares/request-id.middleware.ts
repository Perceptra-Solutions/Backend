import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CABECALHO_REQUEST_ID = 'x-request-id';

/**
 * Aceita o x-request-id do cliente (ou gera um) e o devolve na resposta,
 * para o front colar num bug report.
 *
 * E middleware, e nao interceptor, de proposito: interceptor so roda em
 * rota que casou, entao um 404 sairia sem requestId — justamente o caso
 * em que o rastro e mais util.
 */
export function registrarRequestId(app: INestApplication): void {
  app.use((req: Request, res: Response, proximo: NextFunction) => {
    const recebido = req.headers[CABECALHO_REQUEST_ID];
    const requestId =
      (Array.isArray(recebido) ? recebido[0] : recebido)?.slice(0, 128) || randomUUID();

    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader(CABECALHO_REQUEST_ID, requestId);
    proximo();
  });
}

export function lerRequestId(req: unknown): string {
  return (req as { requestId?: string })?.requestId ?? 'sem-request-id';
}
