import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { CicloQualidadeService } from './ciclo-qualidade.service.js';
import { AbrirNcDeDeteccaoDto } from './dto/abrir-nc.dto.js';

/**
 * Esta rota vive em QUALIDADE, e nao em ingestao, de proposito.
 *
 * Se estivesse em ingestao, ingestao precisaria saber criar NC e o par
 * ingestao<->qualidade fecharia um ciclo de modulos. A regra e: o fluxo mora
 * com o invariante, nao com o dado de entrada. Por isso o TriagemController
 * de ingestao so oferece FALSO_POSITIVO e DUPLICADA — CONFIRMADA acontece
 * aqui, junto com a NC, na mesma transacao.
 */
@ApiTags('nao-conformidades')
@ApiBearerAuth('jwt')
@Controller('deteccoes')
export class DeteccaoNcController {
  constructor(private readonly ciclo: CicloQualidadeService) {}

  @Post(':id/nao-conformidades')
  @Papeis(PapelUsuario.ENGENHEIRO)
  @ApiOperation({
    summary: 'Promove uma deteccao a nao conformidade',
    description:
      'Ato tecnico: somente ENGENHEIRO. Confirma a triagem e cria a NC na ' +
      'mesma transacao. O codigo e o prazo (pela severidade) sao gerados no banco.',
  })
  abrir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AbrirNcDeDeteccaoDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.abrirDeDeteccao(id, dto, ator);
  }
}
