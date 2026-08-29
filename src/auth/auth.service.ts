import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { authConfig } from '../config/auth.config.js';
import { Usuario } from '../identidade/usuario.entity.js';
import type { LoginDto } from './dto/login.dto.js';
import type { LoginResponse } from './dto/login.response.js';
import { SenhaService } from './senha.service.js';
import { TokenService } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly senhas: SenhaService,
    private readonly tokens: TokenService,
    @Inject(authConfig.KEY)
    private readonly cfg: ConfigType<typeof authConfig>,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    // addSelect explicito: senhaHash tem select:false na entidade justamente
    // para nao vazar por acidente em nenhuma outra consulta.
    const usuario = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.senhaHash')
      .where('lower(u.email) = lower(:email)', { email: dto.email })
      .getOne();

    // Mensagem unica para "email nao existe" e "senha errada": distinguir os
    // dois entrega ao atacante uma lista de e-mails validos. E o compare roda
    // mesmo sem usuario, contra um hash descartavel, para o tempo de resposta
    // nao denunciar quais e-mails existem.
    const hashParaComparar =
      usuario?.senhaHash ?? '$2b$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinv';
    const senhaConfere = await this.senhas.conferir(dto.senha, hashParaComparar);

    if (!usuario || !senhaConfere) {
      throw new UnauthorizedException('E-mail ou senha invalidos.');
    }

    if (!usuario.ativo) {
      throw new UnauthorizedException('Este usuario esta desativado.');
    }

    const acessoToken = await this.tokens.assinar({
      id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
    });

    return {
      acessoToken,
      expiraEm: this.cfg.jwtExpiration,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        crea: usuario.crea,
      },
    };
  }

  /**
   * Recarrega o usuario do banco a partir do token. O JWT carrega o papel do
   * momento em que foi emitido; para /auth/eu vale mostrar o estado atual.
   */
  async perfil(id: string) {
    const usuario = await this.usuarios.findOne({ where: { id } });
    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Usuario nao encontrado ou desativado.');
    }

    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      crea: usuario.crea,
      ativo: usuario.ativo,
    };
  }
}
