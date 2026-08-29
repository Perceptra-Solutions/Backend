import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { DispositivoAtual } from '../catalogo-ia/decorators/dispositivo-atual.decorator.js';
import type { EscopoDispositivo } from '../catalogo-ia/dominio/escopos-dispositivo.js';
import { ESCOPO_DETECCAO_INGERIR, ESCOPO_HEARTBEAT } from '../catalogo-ia/dominio/escopos-dispositivo.js';
import { ApiKeyGuard } from '../catalogo-ia/guards/api-key.guard.js';
import type { DispositivoAutenticado } from '../catalogo-ia/tipos/dispositivo-autenticado.js';
import { Publico } from '../auth/decorators/publico.decorator.js';
import { DispositivoService } from './dispositivo.service.js';
import { IngerirDeteccoesDto } from './dto/ingerir-deteccoes.dto.js';
import { RateLimitDispositivoGuard } from './guards/rate-limit-dispositivo.guard.js';

/**
 * `@Publico()` no controller inteiro: o JwtAuthGuard e global e exige JWT
 * por padrao, mas estas rotas sao autenticadas por credencial de
 * dispositivo (ApiKeyGuard), aplicado explicitamente em cada metodo.
 *
 * Sem `:cameraId` em nenhum path — a camera vem SEMPRE da credencial.
 */
@ApiTags('dispositivo')
@ApiSecurity('dispositivo')
@Publico()
@Controller('dispositivo')
export class DispositivoController {
  constructor(private readonly dispositivos: DispositivoService) {}

  @Post('deteccoes')
  @UseGuards(ApiKeyGuard, RateLimitDispositivoGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ingestao em lote de deteccoes (1 a 100 por requisicao)',
    description:
      'Corpo limitado a 1 MB. Imagem NUNCA em base64 aqui — evidencia tem endpoint proprio. ' +
      'Sempre 201: cada item nao aceito vem com seu proprio motivo, nao 207.',
  })
  ingerirDeteccoes(
    @DispositivoAtual() dispositivo: DispositivoAutenticado,
    @Body() dto: IngerirDeteccoesDto,
  ) {
    this.exigirEscopo(dispositivo, ESCOPO_DETECCAO_INGERIR);
    return this.dispositivos.ingerirDeteccoes(dispositivo.cameraId, dto.deteccoes);
  }

  @Post('heartbeat')
  @UseGuards(ApiKeyGuard, RateLimitDispositivoGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sinal de vida da camera' })
  async heartbeat(@DispositivoAtual() dispositivo: DispositivoAutenticado) {
    this.exigirEscopo(dispositivo, ESCOPO_HEARTBEAT);
    await this.dispositivos.registrarHeartbeat(dispositivo.cameraId);
    return { mensagem: 'Heartbeat registrado.' };
  }

  private exigirEscopo(dispositivo: DispositivoAutenticado, escopo: EscopoDispositivo): void {
    if (!dispositivo.escopos.includes(escopo)) {
      throw new ForbiddenException(`Esta credencial nao tem o escopo "${escopo}".`);
    }
  }
}
