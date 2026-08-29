import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('banco.url'),
        ssl: config.get<boolean>('banco.ssl') ? { rejectUnauthorized: false } : false,

        // autoLoadEntities coleta o que foi registrado via forFeature, em
        // memoria. E o caminho certo sob ESM: um glob de caminho
        // ('dist/**/*.entity.js') quebra no Windows com
        // ERR_UNSUPPORTED_ESM_URL_SCHEME, porque o loader le "D:" como protocolo.
        autoLoadEntities: true,

        // NUNCA true: o synchronize apaga CHECK, trigger e indice parcial sem
        // avisar, e sao eles que carregam as invariantes do MER.
        synchronize: false,

        // As migrations sao aplicadas pelo CLI (npm run db:migrate), nunca no
        // boot: subir a aplicacao nao pode alterar schema sem intencao explicita.
        // Em teste nao ha por que insistir: o global-setup ja confirmou o
        // banco, e retry so transforma falha real em espera longa.
        retryAttempts: config.get<string>('app.ambiente') === 'test' ? 0 : 5,
        retryDelay: 2000,

        migrationsRun: false,
        migrationsTableName: 'migracao',

        // O pool fica pequeno de proposito: a POC roda em instancia unica, e
        // um pool grande so mascara consulta lenta.
        poolSize: 10,
        extra: { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 },
        logging: ['error', 'warn'],
      }),
    }),
  ],
})
export class DatabaseModule {}
