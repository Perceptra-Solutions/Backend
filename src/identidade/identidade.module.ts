import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { UsuarioController } from './usuario.controller.js';
import { Usuario } from './usuario.entity.js';
import { UsuarioService } from './usuario.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario]), AuthModule],
  controllers: [UsuarioController],
  providers: [UsuarioService],
  // Exportado porque os outros modulos precisam de exigirEngenheiroAtivo()
  // para validar responsavel, executor e verificador.
  exports: [UsuarioService],
})
export class IdentidadeModule {}
