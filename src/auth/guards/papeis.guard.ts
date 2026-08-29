import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PapelUsuario } from '../../shared/enums/dominio.enums.js';
import { CHAVE_PAPEIS } from '../decorators/papeis.decorator.js';
import type { UsuarioAutenticado } from '../tipos/usuario-autenticado.js';

/**
 * Guard global (APP_GUARD #2), roda depois do JwtAuthGuard — a ordem e a
 * ordem do array de providers no app.module.ts.
 *
 * Decide por PAPEL apenas. Regras que dependem de identidade e de dados
 * ("so o responsavel pela NC", "engenheiro diferente do executor") moram no
 * dominio, onde a entidade ja esta carregada.
 */
@Injectable()
export class PapeisGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exigidos = this.reflector.getAllAndOverride<PapelUsuario[]>(CHAVE_PAPEIS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigidos || exigidos.length === 0) return true;

    const req = contexto.switchToHttp().getRequest<Request & { usuario?: UsuarioAutenticado }>();
    const usuario = req.usuario;

    // Sem usuario aqui significa rota @Publico() com @Papeis() — combinacao
    // sem sentido que vale falhar alto, e nao liberar silenciosamente.
    if (!usuario) {
      throw new ForbiddenException('Rota exige papel mas nao exige autenticacao.');
    }

    if (!exigidos.includes(usuario.papel)) {
      throw new ForbiddenException(
        `Esta acao exige o papel ${exigidos.join(' ou ')}. Seu papel: ${usuario.papel}.`,
      );
    }

    return true;
  }
}
