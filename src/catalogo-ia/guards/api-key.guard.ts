import { CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { analisarChave, conferirHash } from '../dominio/credencial-dispositivo.util.js';
import { CredencialDispositivo } from '../credencial-dispositivo.entity.js';
import type { DispositivoAutenticado } from '../tipos/dispositivo-autenticado.js';

interface EntradaCache {
  credencial: CredencialDispositivo;
  expiraEm: number;
}

const TTL_CACHE_MS = 60_000;

/**
 * Autentica rotas `/dispositivo/*`. Nao e o JwtAuthGuard: essas rotas sao
 * `@Publico()` (o JwtAuthGuard nao tenta interpretar `pcr_...` como JWT —
 * ver o comentario em jwt-auth.guard.ts) e aplicam este guard explicitamente.
 *
 * Cache em memoria de 60s pela credencial: com a camera mandando lotes de
 * deteccao com frequencia, consultar o banco a cada requisicao so para
 * achar a linha (antes mesmo de conferir o hash) seria carga desperdicada.
 * O que fica em cache e a LINHA (hash incluido) — a conferencia do segredo
 * roda em toda requisicao, cache ou nao.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly cache = new Map<string, EntradaCache>();

  constructor(
    @InjectRepository(CredencialDispositivo)
    private readonly repo: Repository<CredencialDispositivo>,
    private readonly config: ConfigService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto
      .switchToHttp()
      .getRequest<Request & { dispositivo?: DispositivoAutenticado }>();

    const chave = this.extrairChave(req);
    if (!chave) {
      throw new UnauthorizedException('Credencial de dispositivo ausente.');
    }

    const partes = analisarChave(chave);
    if (!partes) {
      throw new UnauthorizedException('Credencial de dispositivo em formato invalido.');
    }

    const credencial = await this.buscarCredencial(partes.prefixo);
    if (!credencial) {
      throw new UnauthorizedException('Credencial de dispositivo invalida.');
    }

    if (credencial.revogadaEm) {
      throw new UnauthorizedException('Credencial de dispositivo revogada.');
    }

    const pepper = this.config.getOrThrow<string>('camera.deviceApiKeyPepper');
    if (!conferirHash(partes.segredo, pepper, credencial.hashSecreto)) {
      throw new UnauthorizedException('Credencial de dispositivo invalida.');
    }

    req.dispositivo = {
      credencialId: credencial.id,
      cameraId: credencial.cameraId,
      escopos: credencial.escopos,
    };

    return true;
  }

  private extrairChave(req: Request): string | null {
    const cabecalho = req.headers.authorization;
    if (!cabecalho) return null;

    // Aceita tanto "Authorization: pcr_..." (esquema apiKey do Swagger, que
    // envia o header cru) quanto "Authorization: Bearer pcr_...".
    const semEsquema = cabecalho.toLowerCase().startsWith('bearer ')
      ? cabecalho.slice('bearer '.length).trim()
      : cabecalho.trim();

    return semEsquema.startsWith('pcr_') ? semEsquema : null;
  }

  /** Busca com cache de 60s. So grava `ultimo_uso_em` no cache MISS — ver comentario da classe. */
  private async buscarCredencial(prefixo: string): Promise<CredencialDispositivo | null> {
    const emCache = this.cache.get(prefixo);
    if (emCache && emCache.expiraEm > Date.now()) {
      return emCache.credencial;
    }

    const credencial = await this.repo.findOne({ where: { prefixo } });
    if (!credencial) return null;

    this.cache.set(prefixo, { credencial, expiraEm: Date.now() + TTL_CACHE_MS });

    // Best-effort, nao bloqueia a requisicao: perder uma atualizacao de
    // "ultimo uso" nao tem consequencia, travar a ingestao por causa dela teria.
    this.repo.update({ id: credencial.id }, { ultimoUsoEm: new Date() }).catch(() => {
      /* estatistica de uso, nunca deve derrubar a requisicao */
    });

    return credencial;
  }
}
