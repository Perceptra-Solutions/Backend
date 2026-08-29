import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { appConfig } from './config/app.config.js';
import { authConfig } from './config/auth.config.js';
import { bancoConfig } from './config/banco.config.js';
import { cameraConfig } from './config/camera.config.js';
import { evidenciaConfig } from './config/evidencia.config.js';
import { monitoramentoConfig } from './config/monitoramento.config.js';
import { validate } from './config/env.validation.js';

import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { PapeisGuard } from './auth/guards/papeis.guard.js';
import { CatalogoIaModule } from './catalogo-ia/catalogo-ia.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DispositivoModule } from './dispositivos/dispositivo.module.js';
import { EvidenciaModule } from './evidencias/evidencia.module.js';
import { IdentidadeModule } from './identidade/identidade.module.js';
import { IngestaoModule } from './ingestao/ingestao.module.js';
import { MonitoramentoModule } from './monitoramento/monitoramento.module.js';
import { NormasModule } from './normas/normas.module.js';
import { ObrasModule } from './obras/obras.module.js';
import { PainelModule } from './painel/painel.module.js';
import { QualidadeModule } from './qualidade/qualidade.module.js';
import { RelatoriosModule } from './relatorios/relatorios.module.js';
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
      load: [appConfig, authConfig, bancoConfig, cameraConfig, evidenciaConfig, monitoramentoConfig],
    }),
    // Global: o CameraHeartbeatScheduler (@Interval) precisa do registro do
    // ScheduleModule em algum lugar da arvore — aqui, uma vez, e o de sempre.
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    IdentidadeModule,
    ObrasModule,
    NormasModule,
    IngestaoModule,
    MonitoramentoModule,
    QualidadeModule,
    CatalogoIaModule,
    DispositivoModule,
    EvidenciaModule,
    PainelModule,
    RelatoriosModule,
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
