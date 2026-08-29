import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArmazenamentoModule } from '../armazenamento/armazenamento.module.js';
import { Obra } from '../obras/obra.entity.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { RelatorioItem } from './relatorio-item.entity.js';
import { RelatorioController } from './relatorio.controller.js';
import { Relatorio } from './relatorio.entity.js';
import { RelatorioService } from './relatorio.service.js';

/**
 * Nao importa QualidadeModule, ObrasModule nem NormasModule — le
 * `nao_conformidade` e `obra` registrando as entidades no proprio
 * `forFeature` e usando QueryBuilder (regra 4: leitura nao usa os modulos
 * de escrita). `requisito_norma`, `local` e `usuario` entram por join cru,
 * sem relacao TypeORM, do mesmo jeito que o PainelModule faz.
 *
 * `UnidadeTrabalho` vem do DatabaseModule, que e @Global.
 */
@Module({
  imports: [
    ArmazenamentoModule,
    TypeOrmModule.forFeature([Relatorio, RelatorioItem, NaoConformidade, Obra]),
  ],
  controllers: [RelatorioController],
  providers: [RelatorioService],
})
export class RelatoriosModule {}
