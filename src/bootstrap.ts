import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { registrarRotaNaoEncontrada } from './shared/filtros/rota-nao-encontrada.js';
import { registrarRequestId } from './shared/middlewares/request-id.middleware.js';

/**
 * Configuracao compartilhada entre o main.ts e os testes e2e. Existe para
 * que o teste exercite a MESMA aplicacao que roda em producao — prefixo,
 * pipe e contrato de erro iguais. Duplicar isso no teste e o jeito classico
 * de ter suite verde e producao quebrada.
 *
 * O ValidationPipe e o ExcecaoGlobalFilter vem por APP_PIPE/APP_FILTER no
 * AppModule, entao nao precisam ser reaplicados aqui.
 */
export function configurarApp(app: INestApplication, origensCors: string[] = []): void {
  // Antes de tudo: mesmo um 404 ou um erro de helmet precisa de rastro.
  registrarRequestId(app);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: origensCors.length > 0 ? origensCors : true,
    credentials: true,
  });

  // A versao vive no prefixo global; enableVersioning() seria redundante.
  // /health fica fora: monitoramento nao deve depender da versao da API.
  // O exclude casa rota a rota, nao por prefixo — 'health' sozinho deixaria
  // /health/pronto virar /api/v1/health/pronto, que e o pior dos dois mundos.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/pronto'] });

  // Sem isto o OnModuleDestroy nunca roda e o pool do Postgres fica
  // pendurado a cada reload do --watch. Nao e o default do Nest.
  app.enableShutdownHooks();
}

/** Precisa rodar depois de app.init(), quando as rotas ja estao montadas. */
export function finalizarApp(app: INestApplication): void {
  registrarRotaNaoEncontrada(app);
}
