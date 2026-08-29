import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { enviarStream } from '../shared/util/enviar-stream.js';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { AtualizarObraDto } from './dto/atualizar-obra.dto.js';
import { CriarObraDto } from './dto/criar-obra.dto.js';
import { FiltroObraQuery } from './dto/filtro-obra.query.js';
import { ObraService } from './obra.service.js';
import { PlantaObraService } from './planta-obra.service.js';

@ApiTags('obras')
@ApiBearerAuth('jwt')
@Controller('obras')
export class ObraController {
  constructor(
    private readonly obras: ObraService,
    private readonly plantas: PlantaObraService,
  ) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Cadastra uma obra' })
  criar(@Body() dto: CriarObraDto) {
    return this.obras.criar(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista obras', description: 'Alimenta os seletores de obra em todo o sistema.' })
  listar(@Query() filtro: FiltroObraQuery) {
    return this.obras.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma obra' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.obras.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Atualiza dados cadastrais da obra' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarObraDto) {
    return this.obras.atualizar(id, dto);
  }

  // ------------------------------------------------- planta / mapa da obra

  @Post(':id/planta')
  @Papeis(PapelUsuario.GESTOR)
  @UseInterceptors(FileInterceptor('arquivo'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia (ou substitui) a planta da obra',
    description:
      'Campo do arquivo: "arquivo". Aceita PNG, JPEG, WebP, SVG ou PDF. Subir de novo substitui a ' +
      'planta vigente — não há versionamento, é cadastro e não prova.',
  })
  enviarPlanta(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() arquivo: Express.Multer.File | undefined) {
    return this.plantas.enviar(id, arquivo);
  }

  @Get(':id/planta')
  @ApiOperation({
    summary: 'Metadado da planta da obra',
    description: 'Devolve `existe: false` quando a obra ainda não tem planta. O arquivo sai em /planta/arquivo.',
  })
  metadadosDaPlanta(@Param('id', ParseUUIDPipe) id: string) {
    return this.plantas.metadados(id);
  }

  @Get(':id/planta/arquivo')
  @ApiProduces('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf')
  @ApiOperation({
    summary: 'Baixa a planta da obra',
    description: 'Lê direto do storage, então funciona com qualquer driver. Exige o mesmo Bearer das demais rotas.',
  })
  async arquivoDaPlanta(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { stream, mime, nome } = await this.plantas.abrirArquivo(id);
    enviarStream(res, stream, { mime, nome });
  }
}
