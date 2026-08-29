import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdentidadeModule } from '../identidade/identidade.module.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { AcaoCorretiva } from './acao-corretiva.entity.js';
import { AcaoCorretivaController } from './acao-corretiva.controller.js';
import { CicloQualidadeService } from './ciclo-qualidade.service.js';
import { DeteccaoNcController } from './deteccao-nc.controller.js';
import { NaoConformidade } from './nao-conformidade.entity.js';
import { NaoConformidadeController } from './nao-conformidade.controller.js';
import { NaoConformidadeEvento } from './nao-conformidade-evento.entity.js';
import { NaoConformidadeService } from './nao-conformidade.service.js';
import { Verificacao } from './verificacao.entity.js';

/**
 * O nucleo. Importa IdentidadeModule porque precisa do COMPORTAMENTO
 * exigirEngenheiroAtivo(); nao importa ObrasModule nem NormasModule, apesar
 * das FKs — a existencia daqueles registros e garantida pelo banco, e o 23503
 * vira 422 no mapeador. FK nao e dependencia de modulo.
 *
 * Registra a entidade Deteccao no forFeature porque o ciclo precisa
 * atualizar a triagem na mesma transacao (confirmar ao abrir a NC,
 * devolver a falso positivo ao cancelar).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NaoConformidade,
      NaoConformidadeEvento,
      AcaoCorretiva,
      Verificacao,
      Deteccao,
    ]),
    IdentidadeModule,
  ],
  controllers: [NaoConformidadeController, AcaoCorretivaController, DeteccaoNcController],
  providers: [NaoConformidadeService, CicloQualidadeService],
  exports: [CicloQualidadeService],
})
export class QualidadeModule {}
