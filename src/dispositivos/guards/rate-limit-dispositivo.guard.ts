import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { DispositivoAutenticado } from '../../catalogo-ia/tipos/dispositivo-autenticado.js';

interface Janela {
  contagem: number;
  expiraEm: number;
}

const JANELA_MS = 60_000;
const LIMITE_POR_JANELA = 120;

/**
 * Rate limit por credencial de dispositivo, nao por IP: a camera fala com
 * uma unica credencial atras do NAT de uma obra, entao IP agruparia
 * dispositivos legitimos diferentes sob o mesmo limite.
 *
 * `@nestjs/throttler` da ERESOLVE com Nest 12 nesta arvore de dependencias —
 * ver ANDAMENTO.md. Janela fixa em memoria, mesmo estilo de cache do
 * ApiKeyGuard: suficiente para uma POC de dispositivo unico por processo.
 *
 * Roda DEPOIS do ApiKeyGuard (ordem do array em `@UseGuards`) — precisa de
 * `req.dispositivo` ja preenchido para saber a credencial.
 */
@Injectable()
export class RateLimitDispositivoGuard implements CanActivate {
  private readonly janelas = new Map<string, Janela>();

  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto
      .switchToHttp()
      .getRequest<Request & { dispositivo?: DispositivoAutenticado }>();

    const credencialId = req.dispositivo?.credencialId;
    if (!credencialId) return true;

    const agora = Date.now();
    const janela = this.janelas.get(credencialId);

    if (!janela || janela.expiraEm <= agora) {
      this.janelas.set(credencialId, { contagem: 1, expiraEm: agora + JANELA_MS });
      return true;
    }

    if (janela.contagem >= LIMITE_POR_JANELA) {
      throw new HttpException(
        `Limite de ${LIMITE_POR_JANELA} requisicoes por minuto excedido para esta credencial.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    janela.contagem += 1;
    return true;
  }
}
