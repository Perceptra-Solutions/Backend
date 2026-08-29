import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { appConfig } from './config/app.config.js';
import { authConfig } from './config/auth.config.js';
import { bancoConfig } from './config/banco.config.js';
import { cameraConfig } from './config/camera.config.js';
import { evidenciaConfig } from './config/evidencia.config.js';
import { validate } from './config/env.validation.js';

import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { ExcecaoGlobalFilter } from './shared/filtros/excecao-global.filter.js';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor.js';
import { criarValidationPipe } from './shared/pipes/validacao.pipe.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      // Falha no boot com a lista de variaveis faltando, em vez de falhar
      // na primeira request que usar a variavel — que numa demo acontece
      // sempre na pior hora.
      validate,
      load: [appConfig, authConfig, bancoConfig, cameraConfig, evidenciaConfig],
    }),
    DatabaseModule,
    HealthModule,
  ],
  providers: [
    // O request-id e middleware (ver request-id.middleware.ts), nao interceptor.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_PIPE, useFactory: criarValidationPipe },
    {
      provide: APP_FILTER,
      useFactory: () => new ExcecaoGlobalFilter(process.env.NODE_ENV !== 'production'),
    },
  ],
})
export class AppModule {}
