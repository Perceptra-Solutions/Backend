import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CHAVE_PUBLICO } from '../decorators/publico.decorator.js';
import { TokenService } from '../token.service.js';
import type { UsuarioAutenticado } from '../tipos/usuario-autenticado.js';

/**
 * Guard global (APP_GUARD #1): tudo exige token, e a rota publica precisa
 * dizer com @Publico(). Proteger rota a rota falharia por omissao.
 *
 * Sem passport: sao dois papeis e um RolesGuard custom e necessario de
 * qualquer forma. Tres pacotes a mais nao pagariam o proprio custo.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const ehPublica = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (ehPublica) return true;

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
      // A mensagem e deliberadamente vaga: distinguir "expirado" de
      // "assinatura invalida" para quem nao esta autenticado so ajuda quem
      // esta sondando.
      throw new UnauthorizedException('Token de acesso invalido ou expirado.');
    }
  }

  private extrairToken(req: Request): string | null {
    const cabecalho = req.headers.authorization;
    if (!cabecalho) return null;

    const [esquema, valor] = cabecalho.split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !valor) return null;

    // A credencial de dispositivo (pcr_...) viaja no mesmo header, mas e
    // resolvida pelo ApiKeyGuard das rotas /dispositivo/*. Aqui ela nao vale.
    if (valor.startsWith('pcr_')) return null;

    return valor;
  }
}
