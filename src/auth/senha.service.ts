import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { authConfig } from '../config/auth.config.js';

/**
 * Nota sobre o `import type` do ConfigType: ele e um alias de TIPO puro, sem
 * valor em runtime, e o parametro ja tem @Inject(authConfig.KEY) explicito —
 * o Nest nao depende da metadata aqui. Sem `import type`, o TS 6 recusa com
 * TS1272 sob isolatedModules + emitDecoratorMetadata.
 * A regra oposta vale para CLASSE injetada (ex.: JwtService): ali o import
 * precisa ser de VALOR, senao o design:paramtypes fica quebrado em runtime.
 *
 * bcryptjs em vez de bcrypt/argon2: e JS puro, sem addon nativo e sem
 * install script. No Windows isso evita depender de node-gyp + Visual
 * Studio Build Tools, e no Docker evita compilar nada na imagem.
 */
@Injectable()
export class SenhaService {
  constructor(
    @Inject(authConfig.KEY)
    private readonly cfg: ConfigType<typeof authConfig>,
  ) {}

  hash(senhaEmClaro: string): Promise<string> {
    return bcrypt.hash(senhaEmClaro, this.cfg.bcryptCost);
  }

  conferir(senhaEmClaro: string, hash: string): Promise<boolean> {
    return bcrypt.compare(senhaEmClaro, hash);
  }
}
