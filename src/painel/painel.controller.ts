import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FiltroPainelQuery } from './dto/filtro-painel.query.js';
import { PainelService } from './painel.service.js';

@ApiTags('painel')
@ApiBearerAuth('jwt')
@Controller('painel')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get('resumo')
  @ApiOperation({
    summary: 'Resumo do painel de conformidade em uma unica requisicao',
    description:
      'Todos os cards prontos: NCs abertas por severidade e categoria, prazo vencido, ' +
      'tempo medio de fechamento, taxa de reincidencia, taxa de falso positivo por modelo ' +
      'e saude da frota. Filtre por obraId; sem filtro, cobre todas as obras.',
  })
  resumo(@Query() filtro: FiltroPainelQuery) {
    return this.painel.resumo(filtro);
  }
}
