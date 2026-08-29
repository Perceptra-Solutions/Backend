import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Camera } from '../catalogo-ia/camera.entity.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { PainelController } from './painel.controller.js';
import { PainelService } from './painel.service.js';

/**
 * So le. Nao importa QualidadeModule/CatalogoIaModule/IngestaoModule — cada
 * um deles e dono da ESCRITA da sua entidade; o painel registra as mesmas
 * entidades aqui via forFeature, leitura pura (regra 4 do ANDAMENTO.md).
 */
@Module({
  imports: [TypeOrmModule.forFeature([NaoConformidade, Deteccao, Camera, ModeloIa])],
  controllers: [PainelController],
  providers: [PainelService],
})
export class PainelModule {}
