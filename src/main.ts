import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { configurarApp, finalizarApp } from './bootstrap.js';
import { ObserveInstrument } from './observabilidade/observe.instrument.js';

// NAO importe 'dotenv/config' aqui. Em ESM os imports sao avaliados em
// ordem de declaracao ANTES do corpo do modulo: a arvore inteira do Nest
// executaria antes do dotenv popular process.env. Quem carrega o .env e o
// ConfigModule, no app.module.ts.

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const porta = config.get<number>('app.porta') ?? 3000;

  configurarApp(app, config.get<string[]>('app.corsOrigins') ?? []);

  if (config.get<boolean>('app.swaggerHabilitado')) {
    const doc = new DocumentBuilder()
      .setTitle('Perceptra — Qualidade em Obra')
      .setDescription(
        'Ciclo de nao conformidade: camera detecta, engenheiro tria, NC nasce, ' +
          'acao corretiva acontece e a verificacao (por OUTRO engenheiro) fecha. ' +
          'PBQP-H / NBR 15575.',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .addApiKey({ type: 'apiKey', name: 'authorization', in: 'header' }, 'dispositivo')
      .build();

    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // init() antes do fallback de 404: o middleware precisa entrar DEPOIS
  // que o router do Nest esta montado, senao intercepta todas as rotas.
  await app.init();
  finalizarApp(app);

  await app.listen(porta, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`${config.get('app.nome')} ouvindo em http://localhost:${porta}`);
  logger.log(`Swagger em http://localhost:${porta}/docs`);
}

await bootstrap();
