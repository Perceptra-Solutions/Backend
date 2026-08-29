import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LocalController } from './local.controller.js';
import { Local } from './local.entity.js';
import { LocalService } from './local.service.js';
import { ObraController } from './obra.controller.js';
import { Obra } from './obra.entity.js';
import { ObraService } from './obra.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Obra, Local])],
  controllers: [ObraController, LocalController],
  providers: [ObraService, LocalService],
})
export class ObrasModule {}
