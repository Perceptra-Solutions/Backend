import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArmazenamentoLocal } from './armazenamento-local.js';
import { ArmazenamentoS3 } from './armazenamento-s3.js';
import { ArmazenamentoPort } from './armazenamento.port.js';

/**
 * Decide a implementacao UMA vez, no boot, por `evidencia.driver`
 * (`EVIDENCIA_STORAGE_DRIVER`). O resto da aplicacao injeta `ArmazenamentoPort`
 * e nunca sabe qual das duas esta por tras.
 */
@Module({
  providers: [
    {
      provide: ArmazenamentoPort,
      useFactory: (config: ConfigService): ArmazenamentoPort =>
        config.getOrThrow<'s3' | 'local'>('evidencia.driver') === 's3'
          ? new ArmazenamentoS3(config)
          : new ArmazenamentoLocal(config),
      inject: [ConfigService],
    },
  ],
  exports: [ArmazenamentoPort],
})
export class ArmazenamentoModule {}
