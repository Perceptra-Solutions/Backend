import { CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { TokenService } from '../../auth/token.service.js';
import type { UsuarioAutenticado } from '../../auth/tipos/usuario-autenticado.js';

/**
 * O `EventSource` nativo do navegador não manda header `Authorization` — por
 * isso esta rota é `@Publico()` (foge do JwtAuthGuard global) e usa este
 * guard, que aceita o token também via query string (`?token=...`). Só vale
 * para esta rota; todas as outras continuam exigindo Bearer no header.
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<Request & { usuario?: UsuarioAutenticado }>();
    const token = this.extrairToken(req);
    if (!token) {
      throw new UnauthorizedException('Token de acesso ausente.');
    }

    try {
      const payload = await this.tokens.verificar(token);
      req.usuario = { id: payload.sub, nome: payload.nome, papel: payload.papel };
      return true;
    } catch {
      throw new UnauthorizedException('Token de acesso invalido ou expirado.');
    }
  }

  private extrairToken(req: Request): string | null {
    const doQuery = req.query.token;
    if (typeof doQuery === 'string' && doQuery) return doQuery;

    const cabecalho = req.headers.authorization;
    if (!cabecalho) return null;
    const [esquema, valor] = cabecalho.split(' ');
    return esquema?.toLowerCase() === 'bearer' && valor ? valor : null;
  }
}
