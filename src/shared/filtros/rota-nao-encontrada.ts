import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { lerRequestId } from '../middlewares/request-id.middleware.js';

/**
 * Rota nao encontrada NAO passa pelos ExceptionFilters do Nest: quando
 * nenhuma rota casa, quem responde e o finalhandler do Express, com um
 * HTML "Cannot GET /x". Este middleware devolve o mesmo envelope de erro
 * do resto da API.
 *
 * Precisa ser registrado DEPOIS de app.init(), senao entra antes do
 * router do Nest e intercepta tudo.
 */
export function registrarRotaNaoEncontrada(app: INestApplication): void {
  app.use((req: Request, res: Response, proximo: NextFunction) => {
    if (res.headersSent) return proximo();

    res.status(404).json({
      erro: {
        codigo: 'RECURSO_NAO_ENCONTRADO',
        mensagem: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
        requestId: lerRequestId(req),
        timestamp: new Date().toISOString(),
        caminho: req.originalUrl,
      },
    });
  });
}
