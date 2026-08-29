import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { diskStorage } from 'multer';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module.js';
import { EvidenciaController } from './evidencia.controller.js';
import { Evidencia } from './evidencia.entity.js';
import { EvidenciaService } from './evidencia.service.js';

/**
 * MulterModule.registerAsync (nao options inline no FileInterceptor do
 * controller) para que o caminho do tmp e o limite de tamanho venham do
 * ConfigService, nunca de `process.env` direto — regra do projeto.
 *
 * `diskStorage`, nunca `memoryStorage()`: 200MB de video em memoria por
 * upload simultaneo e o jeito mais rapido de derrubar o processo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Evidencia]),
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
  controllers: [EvidenciaController],
  providers: [EvidenciaService],
})
export class EvidenciaModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  /** O multer nao cria o destino sozinho — sem isto, o primeiro upload falha com ENOENT. */
  async onModuleInit(): Promise<void> {
    await mkdir(this.config.getOrThrow<string>('evidencia.tmpPath'), { recursive: true });
  }
}
