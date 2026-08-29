import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { Camera } from '../catalogo-ia/camera.entity.js';
import { StatusCamera } from '../shared/enums/dominio.enums.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import type { ItemDeteccaoDto } from './dto/ingerir-deteccoes.dto.js';
import type { ResultadoIngestaoResponse } from './dto/resultado-ingestao.response.js';

const JANELA_PASSADO_DIAS = 7;
const JANELA_FUTURO_MINUTOS = 5;

@Injectable()
export class DispositivoService {
  constructor(
    @InjectRepository(Deteccao)
    private readonly deteccoes: Repository<Deteccao>,
    @InjectRepository(ModeloIa)
    private readonly modelos: Repository<ModeloIa>,
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
  ) {}

  /**
   * Ingestao em lote. `cameraId` vem da credencial (ApiKeyGuard), nunca do
   * corpo da requisicao — a rota nao tem `:cameraId` no path de proposito.
   *
   * `obra_id` da deteccao NAO e setado aqui: o trigger `fn_deteccao_obra_da_camera`
   * (BEFORE INSERT) preenche a partir de `camera_id`. Setar aqui duplicaria
   * uma fonte de verdade que ja existe no banco.
   */
  async ingerirDeteccoes(
    cameraId: string,
    itens: ItemDeteccaoDto[],
  ): Promise<ResultadoIngestaoResponse> {
    const agora = Date.now();
    const janelaMin = new Date(agora - JANELA_PASSADO_DIAS * 24 * 60 * 60 * 1000);
    const janelaMax = new Date(agora + JANELA_FUTURO_MINUTOS * 60 * 1000);

    const idsModelo = [...new Set(itens.map((i) => i.modeloIaId))];
    const modelos = idsModelo.length > 0 ? await this.modelos.findBy({ id: In(idsModelo) }) : [];
    const modeloPorId = new Map(modelos.map((m) => [m.id, m]));

    // Tipado solto de proposito: o mapeamento DeepPartial do TypeORM nao
    // aceita um `Record<string, unknown>` cru para a coluna jsonb `bbox`
    // (tenta mapea-lo recursivamente como se fosse relacao) — o cast unico
    // no `.values()' abaixo e o unico jeito de expressar "isto e so JSON".
    const rejeitadas: ResultadoIngestaoResponse['rejeitadas'] = [];
    const candidatas: Record<string, unknown>[] = [];
    let descartadasPorLimiar = 0;

    itens.forEach((item, indice) => {
      const modelo = modeloPorId.get(item.modeloIaId);
      if (!modelo) {
        rejeitadas.push({ indice, idExterno: item.idExterno, motivo: 'MODELO_NAO_ENCONTRADO' });
        return;
      }

      // Relogio do edge desviado envenena serie temporal do painel — melhor
      // rejeitar aqui do que deixar um evento "do futuro" contaminar indicador.
      const ocorridoEm = new Date(item.ocorridoEm);
      if (
        Number.isNaN(ocorridoEm.getTime()) ||
        ocorridoEm < janelaMin ||
        ocorridoEm > janelaMax
      ) {
        rejeitadas.push({
          indice,
          idExterno: item.idExterno,
          motivo: 'OCORRIDO_EM_FORA_DA_JANELA',
        });
        return;
      }

      // Descartada, e nao erro: um modelo mais sensivel manda muita deteccao
      // fraca, e isso e esperado — nao e falha do agente nem do modelo.
      if (item.confianca < modelo.limiarConfianca) {
        descartadasPorLimiar += 1;
        return;
      }

      candidatas.push({
        cameraId,
        modeloIaId: item.modeloIaId,
        idExterno: item.idExterno ?? null,
        classe: item.classe,
        confianca: item.confianca,
        bbox: item.bbox ?? null,
        ocorridoEm,
      });
    });

    let aceitas = 0;
    if (candidatas.length > 0) {
      // orIgnore() -> ON CONFLICT DO NOTHING sem alvo explicito: cobre a
      // unique parcial ux_deteccao_camera_externo (camera_id, id_externo)
      // sem precisar repetir a mesma clausula WHERE aqui.
      const inseridas = await this.deteccoes
        .createQueryBuilder()
        .insert()
        .into(Deteccao)
        .values(candidatas as QueryDeepPartialEntity<Deteccao>[])
        .orIgnore()
        .execute();

      aceitas = inseridas.identifiers.length;
    }

    return {
      aceitas,
      duplicadas: candidatas.length - aceitas,
      descartadasPorLimiar,
      rejeitadas,
    };
  }

  /**
   * Volta a ATIVA se estava OFFLINE por timeout — a camera esta viva de novo.
   * SQL direto (nao QueryBuilder.set com funcao raw): o cast pro enum
   * `status_camera` dentro de um CASE e mais simples de acertar em SQL puro
   * do que via a API do builder, e o resto do projeto ja faz assim para
   * updates com regra embutida.
   */
  async registrarHeartbeat(cameraId: string): Promise<void> {
    await this.cameras.query(
      `UPDATE camera
          SET ultimo_heartbeat = now(),
              status = CASE WHEN status = $2::status_camera THEN $3::status_camera ELSE status END
        WHERE id = $1`,
      [cameraId, StatusCamera.OFFLINE, StatusCamera.ATIVA],
    );
  }
}
