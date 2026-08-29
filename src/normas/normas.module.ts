import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RequisitoNormaController } from './requisito-norma.controller.js';
import { RequisitoNorma } from './requisito-norma.entity.js';
import { RequisitoNormaService } from './requisito-norma.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([RequisitoNorma])],
  controllers: [RequisitoNormaController],
  providers: [RequisitoNormaService],
})
export class NormasModule {}
