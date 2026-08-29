import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Usuario } from '../identidade/usuario.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PapeisGuard } from './guards/papeis.guard.js';
import { SenhaService } from './senha.service.js';
import { TokenService } from './token.service.js';

/**
 * Le o repositorio de Usuario direto, em vez de importar IdentidadeModule.
 * IdentidadeModule ja importa este modulo (para o SenhaService), entao o
 * caminho inverso fecharia um ciclo — e forwardRef() aqui seria tratar o
 * sintoma. Login precisa de UMA consulta por e-mail, nao do servico inteiro.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Usuario]), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SenhaService, TokenService, JwtAuthGuard, PapeisGuard],
  exports: [SenhaService, TokenService, JwtAuthGuard, PapeisGuard],
})
export class AuthModule {}
