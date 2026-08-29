import bcrypt from 'bcryptjs';

/**
 * Executor de SQL. Existe para o seed rodar tanto contra o DataSource real
 * (npm run db:seed) quanto contra o PGlite em processo dos testes, sem
 * duplicar uma linha de dado.
 */
export type Executor = (sql: string, params?: unknown[]) => Promise<Record<string, any>[]>;

/** Senha unica de todos os usuarios semeados. So para desenvolvimento. */
export const SENHA_PADRAO_SEED = 'perceptra123';

const CLASSES_POR_MODELO: Record<string, string[]> = {
  'trinca-detector': ['TRINCA', 'FISSURA', 'INFILTRACAO'],
  'epi-detector': ['SEM_CAPACETE', 'SEM_CINTO', 'SEM_LUVA'],
};

/**
 * Popula o banco com uma obra que conta a historia do desafio de ponta a
 * ponta. Sem estes dados o painel de conformidade abre vazio na demo.
 *
 * Determinismo: nao ha aleatoriedade. Rodar duas vezes no mesmo banco limpo
 * produz exatamente o mesmo resultado, o que mantem os testes estaveis.
 */
export async function semear(exec: Executor) {
  const um = async (sql: string, params: unknown[] = []) => (await exec(sql, params))[0];

  const senhaHash = await bcrypt.hash(SENHA_PADRAO_SEED, 10);

  // ------------------------------------------------------------- usuarios
  // DOIS engenheiros nao e detalhe: sem o segundo, a segregacao de funcao
  // (quem executa nao verifica) nao pode ser demonstrada.
  const gestora = await um(
    `INSERT INTO usuario (nome,email,senha_hash,papel) VALUES ($1,$2,$3,'GESTOR') RETURNING id`,
    ['Helena Duarte', 'gestora@perceptra.dev', senhaHash],
  );
  const engAna = await um(
    `INSERT INTO usuario (nome,email,senha_hash,papel,crea) VALUES ($1,$2,$3,'ENGENHEIRO',$4) RETURNING id`,
    ['Ana Ribeiro', 'ana@perceptra.dev', senhaHash, 'MG-123456/D'],
  );
  const engBruno = await um(
    `INSERT INTO usuario (nome,email,senha_hash,papel,crea) VALUES ($1,$2,$3,'ENGENHEIRO',$4) RETURNING id`,
    ['Bruno Tavares', 'bruno@perceptra.dev', senhaHash, 'MG-654321/D'],
  );

  // ----------------------------------------------------------------- obra
  const obra = await um(
    `INSERT INTO obra (codigo,nome,endereco,cidade,uf,status,responsavel_tecnico_id,inicio_previsto,fim_previsto)
     VALUES ('OB-2026-001','Residencial Aurora','Av. das Acacias, 1200','Santa Rita do Sapucai','MG',
             'EM_ANDAMENTO',$1,'2026-01-15','2027-06-30') RETURNING id`,
    [engAna.id],
  );

  const locais: Record<string, string> = {};
  for (const [chave, tipo, nome, codigo] of [
    ['torreB', 'BLOCO', 'Torre B', 'TB'],
    ['pav7', 'PAVIMENTO', 'Torre B / 7 pav', 'TB-07'],
    ['apto703', 'UNIDADE', 'Torre B / 7 pav / apto 703', 'TB-0703'],
    ['banheiro703', 'AMBIENTE', 'Torre B / 7 pav / apto 703 / banheiro', 'TB-0703-BAN'],
    ['fachada', 'EXTERNO', 'Torre B / fachada norte', 'TB-FAC-N'],
    ['hall', 'AREA_COMUM', 'Torre B / terreo / hall', 'TB-00-HALL'],
  ] as const) {
    const l = await um(
      `INSERT INTO local (obra_id,tipo,nome,codigo) VALUES ($1,$2,$3,$4) RETURNING id`,
      [obra.id, tipo, nome, codigo],
    );
    locais[chave] = l.id;
  }

  // ------------------------------------------------------------ modelos IA
  // Duas versoes do mesmo modelo: e o que permite medir se a v1.3 reduziu o
  // falso positivo em relacao a v1.2 no painel de qualidade da IA.
  const modeloTrincaV12 = await um(
    `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca,metricas,hash_artefato)
     VALUES ('trinca-detector','1.2.0','TRINCA',0.700,$1,$2) RETURNING id`,
    [JSON.stringify({ precision: 0.86, recall: 0.79, mAP: 0.82 }), 'c'.repeat(64)],
  );
  const modeloTrincaV13 = await um(
    `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca,metricas,hash_artefato)
     VALUES ('trinca-detector','1.3.0','TRINCA',0.750,$1,$2) RETURNING id`,
    [JSON.stringify({ precision: 0.93, recall: 0.85, mAP: 0.89 }), 'd'.repeat(64)],
  );
  const modeloEpi = await um(
    `INSERT INTO modelo_ia (nome,versao,tipo_deteccao,limiar_confianca,metricas,hash_artefato)
     VALUES ('epi-detector','2.0.1','EPI',0.800,$1,$2) RETURNING id`,
    [JSON.stringify({ precision: 0.95, recall: 0.9, mAP: 0.92 }), 'e'.repeat(64)],
  );

  // -------------------------------------------------------------- cameras
  const cameras: Record<string, string> = {};
  for (const [chave, identificador, localId, modeloId, status, heartbeat] of [
    ['cam01', 'CAM-01', locais.banheiro703, modeloTrincaV13.id, 'ATIVA', `now() - interval '30 seconds'`],
    ['cam02', 'CAM-02', locais.fachada, modeloTrincaV13.id, 'ATIVA', `now() - interval '2 minutes'`],
    ['cam03', 'CAM-03', locais.hall, modeloEpi.id, 'ATIVA', `now() - interval '1 minute'`],
    // Offline de proposito: o painel de saude da frota precisa ter o que mostrar.
    ['cam04', 'CAM-04', locais.pav7, modeloTrincaV12.id, 'OFFLINE', `now() - interval '3 hours'`],
  ] as const) {
    const c = await um(
      `INSERT INTO camera (obra_id,local_id,modelo_ia_id,identificador,fabricante,protocolo,status,instalada_em,ultimo_heartbeat)
       VALUES ($1,$2,$3,$4,'Perceptra One','RTSP',$5,'2026-02-01',${heartbeat}) RETURNING id`,
      [obra.id, localId, modeloId, identificador, status],
    );
    cameras[chave] = c.id;
  }

  // ------------------------------------------------------ requisitos norma
  // Cobre as 7 categorias de categoria_desempenho: sem isso o painel por
  // categoria tem buracos e o grafico fica torto na apresentacao.
  const requisitos: Record<string, string> = {};
  for (const [chave, norma, item, categoria, descricao] of [
    ['estanq1', 'NBR 15575', 'Parte 3 - 11.2', 'ESTANQUEIDADE', 'Estanqueidade a agua de pisos de areas molhadas'],
    ['estanq2', 'NBR 15575', 'Parte 4 - 10.3', 'ESTANQUEIDADE', 'Estanqueidade a agua de vedacoes verticais externas'],
    ['estanq3', 'NBR 15575', 'Parte 5 - 12.1', 'ESTANQUEIDADE', 'Estanqueidade da cobertura a agua de chuva'],
    ['estrut1', 'NBR 15575', 'Parte 2 - 7.2', 'ESTRUTURAL', 'Estabilidade e resistencia estrutural da estrutura'],
    ['estrut2', 'NBR 15575', 'Parte 4 - 7.1', 'ESTRUTURAL', 'Resistencia a impactos de corpo mole em paredes'],
    ['estrut3', 'NBR 15575', 'Parte 2 - 7.5', 'ESTRUTURAL', 'Deslocamentos e fissuracao em elementos estruturais'],
    ['termico1', 'NBR 15575', 'Parte 1 - 11.2', 'TERMICO', 'Desempenho termico de vedacoes no verao'],
    ['termico2', 'NBR 15575', 'Parte 4 - 11.1', 'TERMICO', 'Transmitancia termica de paredes externas'],
    ['acust1', 'NBR 15575', 'Parte 3 - 12.3', 'ACUSTICO', 'Isolamento a ruido aereo entre unidades'],
    ['acust2', 'NBR 15575', 'Parte 4 - 12.2', 'ACUSTICO', 'Isolamento acustico de fachadas'],
    ['fogo1', 'NBR 15575', 'Parte 1 - 9.3', 'SEGURANCA_FOGO', 'Dificultar a propagacao de incendio'],
    ['fogo2', 'NBR 15575', 'Parte 4 - 9.2', 'SEGURANCA_FOGO', 'Resistencia ao fogo de vedacoes verticais'],
    ['durab1', 'NBR 15575', 'Parte 1 - 14.2', 'DURABILIDADE', 'Vida util de projeto dos sistemas'],
    ['durab2', 'NBR 15575', 'Parte 5 - 14.1', 'DURABILIDADE', 'Durabilidade dos sistemas de cobertura'],
    ['pbqp1', 'PBQP-H', 'SiAC 8.5.1', 'OUTRO', 'Controle da producao e da execucao dos servicos'],
    ['pbqp2', 'PBQP-H', 'SiAC 8.7', 'OUTRO', 'Controle de saidas nao conformes'],
  ] as const) {
    const r = await um(
      `INSERT INTO requisito_norma (norma,item,categoria,descricao) VALUES ($1,$2,$3,$4) RETURNING id`,
      [norma, item, categoria, descricao],
    );
    requisitos[chave] = r.id;
  }

  // ------------------------------------------------------------ deteccoes
  // 30 deteccoes com triagem variada: a fila de triagem precisa ter fila, e
  // o indicador de falso positivo por modelo precisa de falsos positivos.
  const deteccoes: string[] = [];
  const camerasLista = [cameras.cam01, cameras.cam02, cameras.cam03, cameras.cam04];
  const modelosLista = [modeloTrincaV13.id, modeloTrincaV13.id, modeloEpi.id, modeloTrincaV12.id];
  const nomesModelo = ['trinca-detector', 'trinca-detector', 'epi-detector', 'trinca-detector'];

  for (let i = 0; i < 30; i += 1) {
    const idx = i % 4;
    const classes = CLASSES_POR_MODELO[nomesModelo[idx]];
    const classe = classes[i % classes.length];
    // Confianca entre 0.72 e 0.99, deterministica.
    const confianca = (0.72 + ((i * 7) % 28) / 100).toFixed(3);
    const horasAtras = 72 - i * 2;

    // Distribuicao de triagem: 12 pendentes, 10 confirmadas, 6 falsos
    // positivos, 2 duplicadas.
    let status = 'PENDENTE';
    if (i >= 12 && i < 22) status = 'CONFIRMADA';
    else if (i >= 22 && i < 28) status = 'FALSO_POSITIVO';
    else if (i >= 28) status = 'DUPLICADA';

    const triado =
      status === 'PENDENTE'
        ? { por: null, em: 'NULL' }
        : { por: i % 2 === 0 ? engAna.id : engBruno.id, em: `now() - interval '${Math.max(1, horasAtras - 1)} hours'` };

    const duplicadaDe = status === 'DUPLICADA' ? deteccoes[12] : null;

    const d = await um(
      `INSERT INTO deteccao (camera_id,modelo_ia_id,id_externo,classe,confianca,bbox,ocorrido_em,status_triagem,triado_por,triado_em,duplicada_de_id,obra_id)
       VALUES ($1,$2,$3,$4,$5,$6, now() - interval '${horasAtras} hours', $7, $8, ${triado.em}, $9, $10) RETURNING id`,
      [
        camerasLista[idx],
        modelosLista[idx],
        `${['cam01', 'cam02', 'cam03', 'cam04'][idx]}-${String(1000 + i)}`,
        classe,
        confianca,
        JSON.stringify({ x: 100 + i * 3, y: 200 + i * 2, w: 80, h: 60 }),
        status,
        triado.por,
        duplicadaDe,
        obra.id,
      ],
    );
    deteccoes.push(d.id);
  }

  // ------------------------------------------------- naos conformidades
  const confirmadas = deteccoes.slice(12, 22);
  const ncs: Record<string, any> = {};

  // 1. NC RESOLVIDA — o ciclo completo, com acao e verificacao aprovada por
  //    OUTRO engenheiro. E a prova de que a segregacao de funcao funciona.
  ncs.resolvida = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,origem,titulo,descricao,severidade,status,aberta_em,fechada_em)
     VALUES ($1,$2,$3,$4,$5,'IA','Infiltracao no piso do banheiro 703',
             'Mancha de umidade detectada no contrapiso proximo ao ralo.','ALTA','RESOLVIDA',
             now() - interval '20 days', now() - interval '17 days') RETURNING id, codigo`,
    [obra.id, locais.banheiro703, confirmadas[0], requisitos.estanq1, engAna.id],
  );
  const acaoResolvida = await um(
    `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao,causa_raiz,prazo,iniciada_em,concluida_em,custo)
     VALUES ($1,$2,'Remocao do contrapiso e reaplicacao de manta asfaltica',
             'Falha na sobreposicao da manta junto ao ralo','2026-08-15',
             now() - interval '19 days', now() - interval '18 days', 2350.00) RETURNING id`,
    [ncs.resolvida.id, engAna.id],
  );
  await exec(
    `INSERT INTO verificacao (acao_corretiva_id,verificado_por,resultado,parecer,verificado_em)
     VALUES ($1,$2,'APROVADA','Teste de estanqueidade de 72h sem vazamento. Conforme NBR 15575-3.',
             now() - interval '17 days')`,
    [acaoResolvida.id, engBruno.id],
  );

  // 2. NC AGUARDANDO_VERIFICACAO — a acao esta concluida e espera o segundo
  //    engenheiro. E o estado em que a demo mostra o 422 da segregacao.
  ncs.aguardando = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,origem,titulo,descricao,severidade,status,aberta_em)
     VALUES ($1,$2,$3,$4,$5,'IA','Fissura horizontal na fachada norte',
             'Fissura de aproximadamente 1,2m na altura do 7 pavimento.','CRITICA','AGUARDANDO_VERIFICACAO',
             now() - interval '2 days') RETURNING id, codigo`,
    [obra.id, locais.fachada, confirmadas[1], requisitos.estrut3, engBruno.id],
  );
  await exec(
    `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao,causa_raiz,iniciada_em,concluida_em,custo)
     VALUES ($1,$2,'Tratamento da fissura com selante elastico e tela de reforco',
             'Retracao da argamassa de revestimento', now() - interval '1 day', now() - interval '3 hours', 1800.00)`,
    [ncs.aguardando.id, engBruno.id],
  );

  // 3. NC EM_CORRECAO — acao em aberto.
  ncs.emCorrecao = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,origem,titulo,severidade,status,aberta_em)
     VALUES ($1,$2,$3,$4,$5,'IA','Trinca em alvenaria de vedacao do hall','MEDIA','EM_CORRECAO',
             now() - interval '4 days') RETURNING id, codigo`,
    [obra.id, locais.hall, confirmadas[2], requisitos.estrut2, engAna.id],
  );
  await exec(
    `INSERT INTO acao_corretiva (nao_conformidade_id,executor_id,descricao,prazo,iniciada_em)
     VALUES ($1,$2,'Abertura da trinca, aplicacao de tela e novo reboco','2026-09-05', now() - interval '2 days')`,
    [ncs.emCorrecao.id, engAna.id],
  );

  // 4. NC ABERTA e ATRASADA — prazo vencido alimenta o card de urgencia.
  //    aberta ha 10 dias com severidade ALTA (SLA 72h) => vencida.
  ncs.atrasada = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,origem,titulo,severidade,status,aberta_em)
     VALUES ($1,$2,$3,$4,$5,'IA','Infiltracao na cobertura junto a caixa d agua','ALTA','ABERTA',
             now() - interval '10 days') RETURNING id, codigo`,
    [obra.id, locais.torreB, confirmadas[3], requisitos.estanq3, engBruno.id],
  );

  // 5. NC CANCELADA — falso positivo percebido depois da triagem. O painel
  //    tem que EXCLUIR canceladas de todo indicador.
  ncs.cancelada = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,origem,titulo,descricao,severidade,status,aberta_em,fechada_em)
     VALUES ($1,$2,$3,$4,'IA','Suposta trinca em pilar',
             'Cancelada: sombra de andaime interpretada como trinca pelo modelo v1.2.','BAIXA','CANCELADA',
             now() - interval '15 days', now() - interval '14 days') RETURNING id, codigo`,
    [obra.id, locais.pav7, confirmadas[4], requisitos.estrut1, ],
  );

  // 6. REINCIDENCIA — o mesmo problema voltou depois de resolvido. E o
  //    numero mais interessante para PBQP-H, e so existe se houver o vinculo.
  ncs.reincidente = await um(
    `INSERT INTO nao_conformidade (obra_id,local_id,deteccao_id,requisito_norma_id,responsavel_id,reincidencia_de_id,origem,titulo,descricao,severidade,status,aberta_em)
     VALUES ($1,$2,$3,$4,$5,$6,'IA','Infiltracao no piso do banheiro 703 (reincidencia)',
             'Mesma patologia reapareceu 12 dias apos a verificacao aprovada.','CRITICA','ABERTA',
             now() - interval '5 days') RETURNING id, codigo`,
    [obra.id, locais.banheiro703, confirmadas[5], requisitos.estanq1, engAna.id, ncs.resolvida.id],
  );

  // 7-10. NCs MANUAIS — vistoria de campo, sem camera. Cobrem as categorias
  //       que faltam no painel.
  for (const [titulo, requisito, severidade, localId, diasAtras] of [
    ['Ruido aereo acima do limite entre unidades 702 e 703', requisitos.acust1, 'MEDIA', locais.apto703, 6],
    ['Transmitancia termica da parede oeste acima do projeto', requisitos.termico2, 'BAIXA', locais.fachada, 8],
    ['Porta corta-fogo do hall sem selo de conformidade', requisitos.fogo2, 'ALTA', locais.hall, 3],
    ['Registro de controle de execucao incompleto no diario', requisitos.pbqp1, 'MEDIA', locais.torreB, 1],
  ] as const) {
    await exec(
      `INSERT INTO nao_conformidade (obra_id,local_id,requisito_norma_id,responsavel_id,origem,titulo,severidade,status,aberta_em)
       VALUES ($1,$2,$3,$4,'MANUAL',$5,$6,'ABERTA', now() - interval '${diasAtras} days')`,
      [obra.id, localId, requisito, engBruno.id, titulo, severidade],
    );
  }

  // ------------------------------------------------------------ evidencias
  // Hashes deterministicos: nao ha binario de verdade no seed, mas o formato
  // e o vinculo sao reais, entao o endpoint de integridade tem o que checar.
  await exec(
    `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,nao_conformidade_id,tamanho_bytes,mime,capturado_em)
     VALUES ('FOTO','evidencias/1a/2b/${'1a2b'.repeat(15)}abcd.jpg',$1,'MANUAL',$2,$3,248312,'image/jpeg', now() - interval '20 days')`,
    [`${'1a2b'.repeat(15)}abcd`, engAna.id, ncs.resolvida.id],
  );
  await exec(
    `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,autor_id,acao_corretiva_id,tamanho_bytes,mime,capturado_em)
     VALUES ('FOTO','evidencias/3c/4d/${'3c4d'.repeat(15)}ef01.jpg',$1,'MANUAL',$2,$3,301244,'image/jpeg', now() - interval '18 days')`,
    [`${'3c4d'.repeat(15)}ef01`, engAna.id, acaoResolvida.id],
  );
  await exec(
    `INSERT INTO evidencia (tipo,uri,hash_sha256,origem,deteccao_id,tamanho_bytes,mime,capturado_em)
     VALUES ('FOTO','evidencias/5e/6f/${'5e6f'.repeat(15)}2345.jpg',$1,'IA',$2,180023,'image/jpeg', now() - interval '2 days')`,
    [`${'5e6f'.repeat(15)}2345`, confirmadas[1]],
  );

  const [{ n: totalNc }] = await exec(`SELECT count(*)::int n FROM nao_conformidade`);
  const [{ n: totalDet }] = await exec(`SELECT count(*)::int n FROM deteccao`);

  return {
    obraId: obra.id,
    usuarios: { gestora: gestora.id, engAna: engAna.id, engBruno: engBruno.id },
    ncs,
    totais: { naoConformidades: totalNc, deteccoes: totalDet },
  };
}
