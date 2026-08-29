import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { diskStorage } from 'multer';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module.js';
import { LocalController } from './local.controller.js';
import { Local } from './local.entity.js';
import { LocalService } from './local.service.js';
import { ObraController } from './obra.controller.js';
import { Obra } from './obra.entity.js';
import { ObraService } from './obra.service.js';
import { PlantaObraService } from './planta-obra.service.js';

/**
 * O `MulterModule` é registrado aqui, e não só no `EvidenciaModule`: o mixin
 * do `FileInterceptor` injeta `MULTER_MODULE_OPTIONS` do **próprio módulo**
 * do controller. Sem este registro, o upload da planta cairia no default do
 * multer (memória) em vez do `diskStorage` configurado.
 *
 * Reaproveita as chaves `evidencia.tmpPath` / `evidencia.maxBytes` em vez de
 * criar variáveis de ambiente novas: é o mesmo diretório temporário e o
 * mesmo teto de upload do sistema — duplicar a config só criaria mais um
 * lugar para esquecer de configurar.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Obra, Local]),
    ArmazenamentoModule,
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        storage: diskStorage({
          destination: config.getOrThrow<string>('evidencia.tmpPath'),
          filename: (_req, _arquivo, callback) => callback(null, randomUUID()),
        }),
        limits: { fileSize: config.getOrThrow<number>('evidencia.maxBytes') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ObraController, LocalController],
  providers: [ObraService, LocalService, PlantaObraService],
})
export class ObrasModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  /** O multer não cria o destino sozinho — sem isto o primeiro upload falha com ENOENT. */
  async onModuleInit(): Promise<void> {
    await mkdir(this.config.getOrThrow<string>('evidencia.tmpPath'), { recursive: true });
  }
}
