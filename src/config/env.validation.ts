import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  registerDecorator,
  validateSync,
  type ValidationOptions,
} from 'class-validator';

export enum Ambiente {
  development = 'development',
  test = 'test',
  production = 'production',
}

/**
 * A chave do AES-256-GCM precisa ter exatamente 32 bytes. Validar so o
 * comprimento da string base64 nao basta: o que quebra em runtime e o
 * Buffer decodificado, com um `Invalid key length` vindo do node:crypto
 * na primeira vez que alguem cadastra uma camera.
 */
function EhChaveAes256(opcoes?: ValidationOptions) {
  return function (alvo: object, propriedade: string) {
    registerDecorator({
      name: 'ehChaveAes256',
      target: alvo.constructor,
      propertyName: propriedade,
      options: opcoes,
      validator: {
        validate(valor: unknown) {
          if (typeof valor !== 'string') return false;
          try {
            return Buffer.from(valor, 'base64').length === 32;
          } catch {
            return false;
          }
        },
        defaultMessage() {
          return `${propriedade} precisa ser 32 bytes em base64 (gere com: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")`;
        },
      },
    });
  };
}

export class VariaveisDeAmbiente {
  @IsEnum(Ambiente)
  NODE_ENV!: Ambiente;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  APP_NAME!: string;

  // --- banco ---
  @IsString()
  @MinLength(20)
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  DATABASE_URL_TEST?: string;

  @IsOptional()
  @IsBoolean()
  DATABASE_SSL?: boolean;

  // --- auth ---
  @IsString()
  @MinLength(32, {
    message:
      'JWT_SECRET precisa de ao menos 32 caracteres (gere com: node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'base64url\'))")',
  })
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRATION!: string;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_COST?: number;

  // --- evidencia (S3 / Cloudflare R2) ---
  @IsIn(['s3', 'local'], {
    message: 'EVIDENCIA_STORAGE_DRIVER precisa ser "s3" ou "local"',
  })
  EVIDENCIA_STORAGE_DRIVER!: 's3' | 'local';

  @IsInt()
  @Min(1)
  EVIDENCIA_MAX_BYTES!: number;

  @IsString()
  EVIDENCIA_MIME_PERMITIDOS!: string;

  @IsString()
  EVIDENCIA_TMP_PATH!: string;

  @IsOptional()
  @IsString()
  EVIDENCIA_STORAGE_PATH?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsInt()
  S3_URL_TTL_SEGUNDOS?: number;

  // --- camera / dispositivo ---
  @EhChaveAes256()
  CAMERA_URL_STREAM_ENC_KEY!: string;

  @IsInt()
  @Min(30)
  CAMERA_HEARTBEAT_TIMEOUT_SEGUNDOS!: number;

  @IsString()
  @MinLength(16)
  DEVICE_API_KEY_PEPPER!: string;

  // --- monitoramento (AWS: S3 + SQS do pipeline EPI/fissura) ---
  @IsOptional()
  @IsString()
  MONITORAMENTO_AWS_REGION?: string;

  @IsOptional()
  @IsString()
  MONITORAMENTO_AWS_BUCKET?: string;

  @IsOptional()
  @IsString()
  MONITORAMENTO_AWS_QUEUE_URL?: string;

  @IsOptional()
  @IsString()
  MONITORAMENTO_AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  MONITORAMENTO_AWS_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsInt()
  MONITORAMENTO_URL_TTL_SEGUNDOS?: number;

  // --- operacional ---
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;
}

export function validate(configuracaoBruta: Record<string, unknown>) {
  const validado = plainToInstance(VariaveisDeAmbiente, configuracaoBruta, {
    // Sem isso, PORT="3000" (toda env chega como string) nunca satisfaz @IsInt().
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  });

  const erros = validateSync(validado, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (erros.length > 0) {
    const detalhe = erros
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new Error(
      `Configuracao invalida. Corrija o .env (veja .env.example):\n${detalhe}\n`,
    );
  }

  // O driver s3 exige o bloco S3_* completo — checagem condicional que os
  // decorators sozinhos nao expressam.
  if (validado.EVIDENCIA_STORAGE_DRIVER === 's3') {
    const faltando = (
      ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
    ).filter((chave) => !validado[chave]);
    if (faltando.length > 0) {
      throw new Error(
        `EVIDENCIA_STORAGE_DRIVER="s3" exige: ${faltando.join(', ')}. ` +
          'Para rodar sem nuvem, use EVIDENCIA_STORAGE_DRIVER=local.',
      );
    }
  }

  if (validado.EVIDENCIA_STORAGE_DRIVER === 'local' && !validado.EVIDENCIA_STORAGE_PATH) {
    throw new Error('EVIDENCIA_STORAGE_DRIVER="local" exige EVIDENCIA_STORAGE_PATH.');
  }

  return validado;
}
