import { ApiProperty } from '@nestjs/swagger';
import type { CategoriaDesempenho } from '../../shared/enums/dominio.enums.js';
import type { RequisitoNorma } from '../requisito-norma.entity.js';

export class RequisitoNormaResponse {
  @ApiProperty() id!: string;
  @ApiProperty() norma!: string;
  @ApiProperty() item!: string;
  @ApiProperty() categoria!: CategoriaDesempenho;
  @ApiProperty() descricao!: string;

  static de(r: RequisitoNorma): RequisitoNormaResponse {
    return {
      id: r.id,
      norma: r.norma,
      item: r.item,
      categoria: r.categoria,
      descricao: r.descricao,
    };
  }
}
