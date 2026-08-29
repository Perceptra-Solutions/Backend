import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { DispositivoAutenticado } from '../tipos/dispositivo-autenticado.js';

/** Injeta o dispositivo resolvido pelo ApiKeyGuard: `@DispositivoAtual() dispositivo`. */
export const DispositivoAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): DispositivoAutenticado => {
    const req = contexto
      .switchToHttp()
      .getRequest<Request & { dispositivo?: DispositivoAutenticado }>();
    return req.dispositivo as DispositivoAutenticado;
  },
);
