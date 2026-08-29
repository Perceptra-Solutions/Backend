import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

/**
 * Health check escrito a mao, de proposito: @nestjs/terminus@11 declara
 * peer `@nestjs/common: ^10 || ^11` e da ERESOLVE contra o Nest 12 deste
 * projeto. Nao existe versao compativel — e 30 linhas resolvem.
 */
@ApiTags('health')
@Controller('/health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness: o processo esta de pe' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', app: 'perceptra', ambiente: 'development', uptimeSegundos: 42 },
    },
  })
  vivo() {
    return {
      status: 'ok',
      app: this.config.get<string>('app.nome'),
      ambiente: this.config.get<string>('app.ambiente'),
      uptimeSegundos: Math.round(process.uptime()),
    };
  }

  @Get('pronto')
  @ApiOperation({ summary: 'Readiness: o banco responde' })
  async pronto() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (erro) {
      // 503 e nao 500: quem monitora precisa distinguir "fora do ar" de "com defeito".
      throw new ServiceUnavailableException({
        status: 'indisponivel',
        banco: 'fora',
        detalhe: erro instanceof Error ? erro.message : String(erro),
      });
    }

    return { status: 'ok', banco: 'ok', uptimeSegundos: Math.round(process.uptime()) };
  }
}
