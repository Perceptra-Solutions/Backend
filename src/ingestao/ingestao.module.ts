import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { Deteccao } from './deteccao.entity.js';
import { TriagemController } from './triagem.controller.js';
import { TriagemService } from './triagem.service.js';

/**
 * Le a entidade NaoConformidade (para saber se a deteccao ja gerou NC) sem
 * importar QualidadeModule: precisa do DADO, nao do comportamento. Importar
 * o modulo fecharia um ciclo, ja que a rota que promove deteccao a NC vive
 * em qualidade.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Deteccao, NaoConformidade])],
  controllers: [TriagemController],
  providers: [TriagemService],
})
export class IngestaoModule {}
