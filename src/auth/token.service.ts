import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from '../config/auth.config.js';
import type { PayloadJwt, UsuarioAutenticado } from './tipos/usuario-autenticado.js';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY)
    private readonly cfg: ConfigType<typeof authConfig>,
  ) {}

  async assinar(usuario: UsuarioAutenticado): Promise<string> {
    const payload: PayloadJwt = {
      sub: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
    };

    return this.jwt.signAsync(payload, {
      secret: this.cfg.jwtSecret,
      // O jsonwebtoken tipa expiresIn como number | StringValue ('1d', '2h'),
      // e nao como string solta. O valor vem do .env, entao a checagem de
      // formato acontece na validacao de env, nao aqui.
      expiresIn: this.cfg.jwtExpiration as `${number}${'d' | 'h' | 'm' | 's'}`,
    });
  }

  /** Lanca se o token for invalido ou expirado. */
  async verificar(token: string): Promise<PayloadJwt> {
    return this.jwt.verifyAsync<PayloadJwt>(token, { secret: this.cfg.jwtSecret });
  }
}
