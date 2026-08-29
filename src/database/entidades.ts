import { Camera } from '../catalogo-ia/camera.entity.js';
import { CredencialDispositivo } from '../catalogo-ia/credencial-dispositivo.entity.js';
import { Deteccao } from '../ingestao/deteccao.entity.js';
import { Evidencia } from '../evidencias/evidencia.entity.js';
import { Local } from '../obras/local.entity.js';
import { ModeloIa } from '../catalogo-ia/modelo-ia.entity.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { NaoConformidadeEvento } from '../qualidade/nao-conformidade-evento.entity.js';
import { AcaoCorretiva } from '../qualidade/acao-corretiva.entity.js';
import { Obra } from '../obras/obra.entity.js';
import { Relatorio } from '../relatorios/relatorio.entity.js';
import { RelatorioItem } from '../relatorios/relatorio-item.entity.js';
import { RequisitoNorma } from '../normas/requisito-norma.entity.js';
import { Usuario } from '../identidade/usuario.entity.js';
import { Verificacao } from '../qualidade/verificacao.entity.js';

/**
 * Array EXPLICITO de entidades. Nunca use glob (`entities: ['dist/**\/*.entity.js']`):
 * sob ESM no Windows o caminho vira "D:\..." e o loader do Node rejeita com
 * ERR_UNSUPPORTED_ESM_URL_SCHEME, porque le "D:" como protocolo.
 *
 * Este arquivo NAO e um barrel de conveniencia — e a lista que o DataSource
 * do CLI precisa. Nenhum outro arquivo deve importar entidades daqui.
 */
export const ENTIDADES = [
  Usuario,
  Obra,
  Local,
  ModeloIa,
  Camera,
  CredencialDispositivo,
  RequisitoNorma,
  Deteccao,
  NaoConformidade,
  NaoConformidadeEvento,
  AcaoCorretiva,
  Verificacao,
  Evidencia,
  Relatorio,
  RelatorioItem,
];
