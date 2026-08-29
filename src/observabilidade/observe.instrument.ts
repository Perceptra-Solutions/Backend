import { createObserveModule } from '@nestjs/observe';

/**
 * O createObserveModule() mora AQUI, e nao no app.module.ts, para que o
 * main.ts possa importar o instrument sem carregar a arvore inteira de
 * modulos so para isso.
 *
 * Estado anterior do repo: o ObserveModule era desestruturado no
 * app.module.ts mas nunca entrava no array `imports`, enquanto o main.ts
 * ja passava o instrument ao NestFactory — meio configurado, que e a pior
 * das opcoes para depurar.
 */
export const { ObserveModule, ObserveInstrument } = createObserveModule();
