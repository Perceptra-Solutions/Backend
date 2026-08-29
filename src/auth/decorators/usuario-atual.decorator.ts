import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UsuarioAutenticado } from '../tipos/usuario-autenticado.js';

/** Injeta o usuario do token no handler: `@UsuarioAtual() usuario`. */
export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const req = contexto.switchToHttp().getRequest<Request & { usuario?: UsuarioAutenticado }>();
    return req.usuario as UsuarioAutenticado;
  },
);
