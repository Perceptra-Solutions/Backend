import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Camera } from '../catalogo-ia/camera.entity.js';
import { CatalogoIaModule } from '../catalogo-ia/catalogo-ia.module.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { DispositivoController } from './dispositivo.controller.js';
import { DispositivoService } from './dispositivo.service.js';
import { RateLimitDispositivoGuard } from './guards/rate-limit-dispositivo.guard.js';

/**
 * So importa CatalogoIaModule pelo ApiKeyGuard que ele exporta (comportamento).
 * Os dados que este modulo precisa (Deteccao, ModeloIa, Camera) sao
 * registrados aqui mesmo via forFeature — mesmo padrao de IngestaoModule
 * lendo NaoConformidade sem importar QualidadeModule.
 *
 * Sem middleware de limite de corpo proprio: o body-parser JSON global do
 * Nest ja limita a 100kb, mais apertado que o 1MB do ANDAMENTO.md. Um lote
 * de 100 deteccoes SEM imagem (o DTO nao aceita nenhum campo de blob) fica
 * folgado nessa faixa — colocar um segundo `json()` so para esta rota
 * arriscaria ler o corpo duas vezes (o parser global ja consumiu o stream).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Deteccao, ModeloIa, Camera]), CatalogoIaModule],
  controllers: [DispositivoController],
  providers: [DispositivoService, RateLimitDispositivoGuard],
})
export class DispositivoModule {}
