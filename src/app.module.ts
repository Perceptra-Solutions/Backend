import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { appConfig } from './config/app.config.js';
import { authConfig } from './config/auth.config.js';
import { bancoConfig } from './config/banco.config.js';
import { cameraConfig } from './config/camera.config.js';
import { evidenciaConfig } from './config/evidencia.config.js';
import { validate } from './config/env.validation.js';

import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { PapeisGuard } from './auth/guards/papeis.guard.js';
import { DatabaseModule } from './database/database.module.js';
import { IdentidadeModule } from './identidade/identidade.module.js';
import { IngestaoModule } from './ingestao/ingestao.module.js';
import { QualidadeModule } from './qualidade/qualidade.module.js';
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
    AuthModule,
    IdentidadeModule,
    IngestaoModule,
    QualidadeModule,
    HealthModule,
  ],
  providers: [
    // O request-id e middleware (ver request-id.middleware.ts), nao interceptor.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_PIPE, useFactory: criarValidationPipe },

    // A ordem do array E a ordem de execucao: autentica, depois autoriza.
    // Ambos globais de proposito — proteger rota a rota falha por omissao,
    // e o modo de falha de uma rota esquecida e "aberta a todos".
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PapeisGuard },
    {
      provide: APP_FILTER,
      useFactory: () => new ExcecaoGlobalFilter(process.env.NODE_ENV !== 'production'),
    },
  ],
})
export class AppModule {}
