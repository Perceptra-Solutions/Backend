# Andamento do backend — o que foi feito e como continuar

Documento de passagem. O [README.md](README.md) explica como rodar; este explica **o que existe, por quê está assim, e o que fazer a seguir**.

Última atualização: 29/08/2026 · Fases 1–6 concluídas · 116 testes unitários passando.

---

## 1. Estado atual em uma tela

| Fase | Escopo | Estado |
|---|---|---|
| 1 | Fundação: config, contrato de erro, bootstrap, health | ✅ |
| 2 | Banco: 14 entidades, 3 migrations, seed, Docker | ✅ |
| 3 | Auth + ciclo da qualidade (o núcleo do desafio) | ✅ |
| 4 | Ingestão de detecções + evidências | ✅ |
| 5 | Painel de conformidade + relatórios | ✅ |
| 6 | CRUD de cadastros, rate limit, acabamento | ✅ |

**56 endpoints no ar.** Testes: 116 unitários (sem banco, PGlite em processo).

> **Fases 4, 5 e 6 não foram validadas contra Postgres real.** Este ambiente
> não tem Docker disponível — a verificação de cada uma foi typecheck + lint +
> os testes unitários (incluindo, a partir da Fase 5, specs de SQL direto
> contra as migrations reais via PGlite em processo — ver `painel-sql.spec.ts`
> e `dispositivo-sql.spec.ts`) + um boot smoke-test (`node dist/main.js`) que
> confirma toda a árvore de módulos resolvendo via DI até o ponto de conectar
> no banco. **Antes de considerar Fases 4–6 fechadas, rode `npm run test:e2e`
> com o Postgres do Docker de pé** — ver seção 7. Os 17 e2e existentes (Fase 3)
> tambem não foram re-executados aqui.

```bash
docker compose up -d --build && docker compose --profile seed run --rm seed
```

---

## 2. O que já funciona ponta a ponta

O ciclo completo do Desafio 1, verificado por e2e:

1. Engenheiro abre a fila de triagem (`GET /deteccoes?statusTriagem=PENDENTE`)
2. Promove uma detecção a NC (`POST /deteccoes/:id/nao-conformidades`) — confirma a triagem e cria a NC **na mesma transação**
3. Código `NC-2026-000012` e prazo de 72h gerados por trigger a partir da severidade
4. Registra ação corretiva → NC vai para `EM_CORRECAO`
5. Executor conclui → `AGUARDANDO_VERIFICACAO` (e `fechada_em` continua **nulo**)
6. **O executor tentando verificar a própria ação recebe 422 `SEGREGACAO_FUNCAO_VIOLADA`**
7. Outro engenheiro reprova → volta para `EM_CORRECAO`, **prazo não estendido**
8. Nova ação, aprovação → `RESOLVIDA` com `fechada_em === verificado_em`
9. `GET /nao-conformidades/:id/historico` mostra cada transição com quem a fez

### Fase 4 — o que foi entregue (não verificado por e2e — ver aviso acima)

**4.1 Identidade do dispositivo** — `src/catalogo-ia/`
- `credencial_dispositivo` (migration `1756400003000-CredencialDispositivo`): `prefixo` UNIQUE, `hash_secreto` char(64) com CHECK de formato hex, `escopos text[]`, `revogada_em`, `ultimo_uso_em`. FK para `camera` com `ON DELETE RESTRICT`.
- Formato da chave: `pcr_<prefixo-12-hex>_<segredo-base64url-32-bytes>`. Geração/hash/conferência em `dominio/credencial-dispositivo.util.ts` (puro, 8 testes).
- **Achado pelo próprio teste, não por revisão manual**: base64url usa `_` como caractere válido (62/63 do alfabeto) — um `chave.split('_')` ingênuo quebra sempre que o segredo sorteado contém underscore (comum, ~1 em cada poucas gerações). `analisarChave()` corta só nos dois primeiros `_`, tratando o resto como segredo inteiro. Sem o teste `analisarChave separa prefixo e segredo de uma chave valida`, isso teria passado no code review e falhado de forma intermitente em produção.
- `ApiKeyGuard` (`catalogo-ia/guards/api-key.guard.ts`): cache em memória de 60s por prefixo, `timingSafeEqual` na comparação, atualiza `ultimo_uso_em` best-effort (nunca bloqueia a resposta).
- `POST /cameras/:id/credenciais` (GESTOR) emite e mostra a chave uma vez. `POST /cameras/:id/credenciais/:credencialId/revogacao` revoga.
- Sem sistema de escopos genérico (Reflector + decorator): só 2 rotas usam escopo (`deteccao:ingerir`, `heartbeat:enviar`), checado inline no controller — um decorator dedicado seria over-engineering para 2 usos.

**4.2 Ingestão em lote** — `src/dispositivos/`
- `POST /dispositivo/deteccoes`: 1–100 itens, sem campo de imagem no DTO (não é possível mandar blob mesmo tentando). Sem middleware de limite de corpo próprio — o body-parser JSON global do Nest (100kb) já é mais apertado que o 1MB do plano original, e é folgado para 100 detecções sem imagem.
- Dedup via `ON CONFLICT DO NOTHING` (sem alvo explícito — cobre o índice parcial existente) + contagem por `identifiers.length` do resultado, não por mapeamento posicional (`RETURNING` não preserva posição de linhas descartadas por conflito).
- `confianca < limiar` descarta sem erro; `ocorrido_em` fora de `[now()-7d, now()+5min]` rejeita com motivo. Resposta sempre `201` com `{aceitas, duplicadas, descartadasPorLimiar, rejeitadas[]}`.
- `obra_id` da detecção **não é setado pelo service** — o trigger `fn_deteccao_obra_da_camera` (já existente, Fase 2) preenche a partir de `camera_id`. Verificado em `dispositivo-sql.spec.ts` contra as migrations reais.
- `POST /dispositivo/heartbeat`: `UPDATE` com `CASE WHEN status = 'OFFLINE' THEN 'ATIVA' ELSE status END` — só acorda quem estava OFFLINE, não mexe em MANUTENCAO. `CameraHeartbeatScheduler` (`@Interval(30_000)`) marca OFFLINE quem passou de `CAMERA_HEARTBEAT_TIMEOUT_SEGUNDOS` sem heartbeat.

**4.3 Evidências** — `src/armazenamento/` + `src/evidencias/`
- `ArmazenamentoPort` (`abstract class`) com `ArmazenamentoS3` (presigner incluído) e `ArmazenamentoLocal`, escolhida uma vez no boot via `evidencia.driver`.
- Upload por `MulterModule.registerAsync` (nunca opção inline no `FileInterceptor` do controller — precisa vir do `ConfigService`, não de `process.env` direto) com `diskStorage`. SHA-256 via `pipeline(stream, createHash('sha256'))`. Chave por conteúdo (`evidencias/{sha[0:2]}/{sha[2:4]}/{sha}.ext`).
- `GET /evidencias/:id/integridade` baixa de novo do storage e recalcula — não confia no hash gravado no banco.
- `EvidenciaModule.onModuleInit` cria o diretório de tmp; sem isso o primeiro upload falha com ENOENT (multer não cria o destino sozinho).

**4.4 Câmera** — `dominio/camera-stream.crypto.ts`
- AES-256-GCM, envelope `enc:v1:<iv>:<tag>:<ct>`, testado com tag de autenticação adulterada (deve rejeitar) e IV aleatório (duas cifragens da mesma string nunca são iguais). `PATCH /cameras/:id/stream` cifra e grava; a API nunca devolve a URL, cifrada ou não.

**Verificação realizada**: `npm run typecheck`, `npm run lint`, `npm test` (108/108) e um boot smoke-test (`NODE_ENV=test node dist/main.js`) confirmando `AppModule dependencies initialized` antes da falha esperada de conexão (sem Postgres neste ambiente). **Não realizada**: `test:e2e`, teste manual via Swagger/curl contra API rodando, teste de upload real contra S3/R2.

### Fase 5 — Painel (não verificado por e2e — ver aviso acima)

**`GET /painel/resumo`** (`src/painel/`) — todos os cards do dashboard numa unica requisicao, filtravel por `obraId`:

- NCs abertas por severidade e por categoria de norma (NC sem `requisito_norma_id` cai no bucket `NAO_CLASSIFICADA`, nunca some da contagem).
- NCs com prazo vencido (nao-terminal e `prazo < now()`).
- Tempo medio de fechamento em horas — so `RESOLVIDA` entra; `CANCELADA` tambem tem `fechada_em` mas nao conta como fechamento de qualidade.
- Taxa de reincidencia — `reincidencia_de_id` preenchido / total, com `status <> 'CANCELADA'` no denominador.
- Taxa de falso positivo por modelo/versao de IA — `FALSO_POSITIVO` / triadas (exclui `PENDENTE`, que ainda nao foi julgada), isolado por `modelo_ia_id` para um modelo ruim nao se diluir na media geral.
- Saude da frota — contagem de cameras por `status`.

`PainelModule` nao importa `QualidadeModule`/`CatalogoIaModule`/`IngestaoModule`: registra as mesmas entidades via `forFeature` (regra 4 da secao 6) e le com `QueryBuilder`, incluindo um `LEFT JOIN` cru em `requisito_norma` (sem relacao TypeORM) para a categoria. As agregacoes usam os indices `ix_nc_abertas`, `ix_deteccao_pendente` e `ix_camera_heartbeat` ja existentes desde a Fase 2.

**Verificacao extra alem do smoke-test**: como `PainelService` fala com o banco via `Repository`/`QueryBuilder` (exige DataSource real), `src/painel/painel-sql.spec.ts` roda a MESMA agregacao de cada metodo como SQL direto contra as migrations reais via PGlite em processo — pega erro de sintaxe, cast ou `GROUP BY` errado sem precisar de Docker. Mesmo assim, a chamada real via TypeORM (geracao de SQL pelo QueryBuilder, nomes de coluna camelCase→snake_case) nunca rodou de ponta a ponta.

**Relatorio (`Relatorio`/`RelatorioItem`) continua sem CRUD.** As entidades e os indices de armazenamento ja existem desde a Fase 2, mas o ANDAMENTO original so descrevia o painel de indicadores para a Fase 5 — geracao/persistencia de relatorio (PDF, hash, `arquivo_uri`) nao tinha escopo definido aqui e ficou de fora para nao inventar requisito. Definir esse escopo é o proximo passo natural, nao coberto ainda.

### Fase 6 — Cadastros e rate limit (não verificado por e2e — ver aviso acima)

CRUD completo (criar, listar, detalhar, atualizar — sem exclusao, mesmo raciocinio do `usuario.service.ts`: FKs `RESTRICT` protegem quem tem dependente) para as cinco entidades que so tinham `*.entity.ts`:

- **`ObrasModule`** (novo) — `Obra` (`/obras`) e `Local` (`/locais`, filtra por `obraId`). `obraId` de um local nao muda depois de criado.
- **`NormasModule`** (novo) — `RequisitoNorma` (`/requisitos-norma`).
- **`CatalogoIaModule`** (estendido) — `ModeloIa` (`/modelos-ia`): `AtualizarModeloIaDto` so expoe `ativo` e `limiarConfianca`, porque o trigger `trg_modelo_ia_imutavel` bloqueia UPDATE de qualquer outra coluna — versao publicada e imutavel, nova versao e linha nova.
- **`CatalogoIaModule`** (estendido) — `Camera` ganhou `POST/GET/GET:id/PATCH:id` em `/cameras`. `urlStream` continua fora de `CriarCameraDto`/`AtualizarCameraDto`: so `PATCH :id/stream` (Fase 4) grava, sempre cifrado. `status` no PATCH permite marcar `MANUTENCAO` manualmente; `OFFLINE` por falta de heartbeat continua automatico via `CameraHeartbeatScheduler`.

Nenhum dos services acima valida a existencia de `obraId`/`localId`/`modeloIaId` antes de gravar — de proposito, seguindo a regra 1 da secao 6 (`FK não é dependência de módulo`): a FK real (ja criada desde a migration Init) faz a checagem, e o `erro-postgres.mapper.ts` traduz `23503`/`23001` em `422`/`409`. Entradas novas foram adicionadas em `MENSAGEM_POR_CONSTRAINT` para as constraints de unicidade e CHECK dessas cinco entidades.

**Rate limit por credencial** (`src/dispositivos/guards/rate-limit-dispositivo.guard.ts`, ~50 linhas) — janela fixa de 60s em memoria, 120 requisicoes por credencial, aplicado com `@UseGuards(ApiKeyGuard, RateLimitDispositivoGuard)` em `POST /dispositivo/deteccoes` e `POST /dispositivo/heartbeat`. Chaveado por `credencialId` (nao por IP: varias cameras de uma obra saem pelo mesmo NAT). `@nestjs/throttler` continua fora do `package.json` — da `ERESOLVE` com Nest 12 nesta arvore, exatamente como o plano original previa.

**Verificação realizada**: `npm run typecheck`, `npm run lint`, `npm test` (116/116, incluindo os 8 novos casos de `painel-sql.spec.ts`) e o mesmo boot smoke-test da Fase 4. **Não realizada**: `test:e2e`, teste manual via Swagger/curl, e nenhuma chamada real ao `PainelService`/aos novos controllers via TypeORM contra Postgres.

---

## 3. Decisões que não são óbvias

Coisas que parecem detalhe e não são. Se você mudar alguma, saiba o que quebra.

### O ator da auditoria viaja por variável de sessão

O histórico é escrito por **trigger**, não pelo service — assim um `UPDATE` vindo de script também é capturado. Mas um trigger não conhece o JWT. A solução está em [unidade-trabalho.service.ts](src/database/unidade-trabalho.service.ts):

```ts
await manager.query(`SELECT set_config('perceptra.ator_id', $1, true)`, [atorId ?? '']);
```

`set_config(..., true)` é o `SET LOCAL` parametrizável — o `SET LOCAL` literal não aceita parâmetro, e concatenar o id na string seria injeção de SQL. O `true` limita à transação; sem ele o ator vazaria para a próxima query que pegasse a mesma conexão do pool.

### Lock pessimista, porque não há coluna de versão

O MER não tem `version`, então lock otimista é impossível. Toda transição faz `SELECT ... FOR UPDATE` na linha da NC. Sem isso, aprovar e cancelar simultaneamente produz last-write-wins silencioso: os dois leem `AGUARDANDO_VERIFICACAO`, os dois acham a transição válida, e o último `UPDATE` vence sem que ninguém perceba.

### As regras vivem em três camadas, de propósito

| Camada | Papel |
|---|---|
| `src/qualidade/dominio/` | decide **se** a regra permite — funções puras, 34 testes em 22ms |
| `CicloQualidadeService` | coordena a transação e os efeitos colaterais |
| Banco (CHECK + trigger) | rede de segurança contra seed, script e rota futura |

As três dizem a mesma coisa. O domínio dá a mensagem útil; o banco garante que nem um `INSERT` direto burla. Remover a camada do banco parece redundância eliminada e é justamente o que um auditor não aceitaria.

### `fechada_em = verificado_em`, nunca `now()`

Os dois números aparecem no relatório e precisam bater. Há um teste e2e afirmando exatamente isso.

### O prazo não é reaberto na reprovação

O SLA continua contado desde `aberta_em`. A obra não ganha tempo por ter feito a correção errada — e é isso que torna o indicador de atraso honesto. É também o argumento de venda do painel.

### "Atrasada" não é status

É derivado (`prazo < now() AND status NOT IN (terminais)`). Colocar no enum misturaria dimensão temporal com dimensão de fluxo e exigiria um job para mudar status à meia-noite.

### Guard decide por papel; segregação de função decide por identidade

`@Papeis(ENGENHEIRO)` no guard **mais** `exigirSegregacaoDeFuncao(executorId, atorId)` no domínio. Confundir os dois é o erro clássico aqui: o guard não tem a ação carregada e não sabe quem a executou.

### Transições são sub-recursos de ação

`POST /nao-conformidades/:id/cancelamento`, não `PATCH {status}`. Um PATCH genérico convida o cliente a inventar transições e não tem onde carregar o payload de cada ato (o motivo do cancelamento, o parecer da verificação).

---

## 4. Armadilhas já pagas — não repita

Cada uma custou tempo real nesta implementação.

| Armadilha | Sintoma | O que fazer |
|---|---|---|
| **Postgres 18 mudou o volume** | container em restart loop | monte em `/var/lib/postgresql`, **não** em `/var/lib/postgresql/data` |
| **`ON DELETE RESTRICT` levanta `23001`** | 500 em vez de 409 ao apagar registro com dependentes | já tratado em `erro-postgres.mapper.ts`; não assuma que FK sempre dá 23503 |
| **`@Query()` + `@Query('x')` juntos** | `property X should not exist` | um único DTO de filtro estendendo `PaginacaoQuery`. Com `forbidNonWhitelisted` o objeto de query inteiro é validado contra um DTO só |
| **`save()` não traz coluna de trigger** | NC voltava com `codigo: undefined` | recarregue após o insert (`recarregar()` no ciclo) |
| **`exclude` do prefixo casa rota a rota** | `/health` sem prefixo e `/health/pronto` com | liste as duas: `exclude: ['health', 'health/pronto']` |
| **`ConfigType` em construtor decorado** | TS1272 | use `import type` — é alias de tipo puro e o `@Inject()` já resolve. Para **classe** injetada é o oposto: import de valor |
| **Guard global protegeu o `/health`** | HEALTHCHECK do container falhando | `@Publico()` no HealthController |
| **`pglite-server` (socket)** | erro da query N chega no catch da N+1 | não use para testar erro; use PGlite **em processo** (`pglite-runner.ts`) |
| **`globalSetup` do Vitest não lê `.env`** | e2e sem `DATABASE_URL` | `import 'dotenv/config'` no `vitest.config.e2e.ts` |
| **`base64url` contém `_`** | `chave.split('_')` na credencial de dispositivo quebra quando o segredo sorteado tem underscore no meio (comum) | corte só nos dois primeiros `_` (`indexOf`, não `split`); pego pelo próprio teste, não por revisão — ver `credencial-dispositivo.util.ts` |
| **`QueryDeepPartialEntity` não aceita `Record<string,unknown>` cru** | erro de tipo no `.values()` de insert em massa para coluna `jsonb` tipada como objeto solto | tipe o array de entrada solto (`Record<string, unknown>[]`) e faça UM cast localizado no `.values()`, comentando por quê |
| **`FileInterceptor('campo')` sem options não é `memoryStorage()` por padrão** | pareceria certo mas usaria o default do multer se não houver `MulterModule` importado no mesmo módulo | `MulterModule.registerAsync({ useFactory, inject: [ConfigService] })` no módulo do controller — o mixin do `FileInterceptor` injeta `MULTER_MODULE_OPTIONS` do próprio módulo |

E as três regras que destroem trabalho silenciosamente, repetidas do README: **nunca `synchronize: true`**, **nunca plugin esbuild/swc no Vitest**, **nunca glob de entities**.

---

## 5. O que falta, em ordem

Fases 4, 5 e 6 foram concluídas — ver as respectivas subseções "o que foi
entregue" na seção 2, e o aviso de verificação no topo do documento (nenhuma
delas rodou `test:e2e` contra Postgres real neste ambiente).

Não há uma "Fase 7" planejada. O que resta é o que a seção 8 (Pendências
conhecidas) já registrava mais um item novo:

1. **Validar Fases 4–6 contra Postgres real.** `docker compose up -d --build`
   e depois `npm run test:e2e` — ver seção 7. É o item de maior risco: nenhuma
   query do `PainelService` nem dos controllers novos rodou via TypeORM contra
   um banco de verdade, só typecheck/lint/unitários/SQL-crua-via-PGlite.
2. **Definir e implementar geração/persistência de relatório.** `Relatorio` e
   `RelatorioItem` têm entidade e índices desde a Fase 2 e continuam sem
   module/controller/service — a Fase 5 original só descrevia o painel de
   indicadores, não o relatório em si (PDF, hash, `arquivo_uri`). Escopo (o
   que gera o arquivo, onde fica o hash, quem chama) não foi definido ainda.
3. **Os itens da seção 8** — nenhum é bloqueante para uma demo, mas valem a
   leitura antes de uma apresentação: escopo por obra ausente, câmera com um
   modelo só, sem papel AUDITOR, sem notificação.

---

## 6. Como continuar sem tropeçar

**O molde de um módulo novo** — copie a estrutura de `identidade/`:

```
src/<modulo>/
├─ <entidade>.entity.ts        já existe para todas as 14
├─ <entidade>.service.ts       regra + acesso via @InjectRepository
├─ <entidade>.controller.ts    rotas, @Papeis, @ApiOperation
├─ <modulo>.module.ts          forFeature + imports do que precisa
└─ dto/
   ├─ criar-*.dto.ts
   ├─ filtro-*.query.ts        estenda PaginacaoQuery
   └─ *.response.ts            mapeamento explícito, sem vazar campo sensível
```

**Regras de dependência entre módulos** (é o que mantém o projeto sem `forwardRef`):

1. **FK não é dependência de módulo.** Importe outro módulo só quando precisar do *comportamento* dele. A existência de uma FK é garantida pelo banco, e o 23503 vira 422.
2. **O fluxo mora com o invariante, não com o dado de entrada.** Por isso `POST /deteccoes/:id/nao-conformidades` está em `qualidade/`, não em `ingestao/`.
3. **Evidência é folha**: trata os três ids como UUIDs opacos e não importa nenhum agregado.
4. **Leitura não usa os módulos de escrita**: painel e relatórios terão repositório próprio.

Se você precisar de `forwardRef()`, a regra 2 foi violada. Mova a regra, não use o `forwardRef`.

**Ao criar migration**: escreva à mão. `migration:generate` não produz CHECK, trigger, índice parcial nem FK com política de delete — que é o que carrega as regras aqui. Registre em `index-migrations.ts` (lista explícita, sem glob) e a entidade em `entidades.ts`.

**Ao adicionar invariante**: adicione em `src/database/invariantes.spec.ts` também. Ele roda as migrations reais contra PGlite em processo e não precisa de banco — é a rede mais barata que existe neste projeto.

---

## 7. Verificação

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` não precisa de banco. Para o e2e, o Postgres do container precisa estar de pé e o banco de teste migrado:

```bash
docker compose run --rm -e DATABASE_URL="postgresql://perceptra:perceptra@postgres:5432/qualidade_obra_test" migracao
```

```bash
npm run test:e2e
```

---

## 8. Pendências conhecidas

- **Escopo por obra não existe.** Qualquer usuário autenticado vê NC de qualquer obra. O plano decidiu deixar `usuario_obra` fora da POC, mas isso é um furo de autorização apresentado como feature — vale dizer em voz alta na apresentação, não esconder.
- **Câmera roda um modelo só.** O deck vende por módulo de IA ("Starter = 1 módulo, Professional = 2"), mas `camera.modelo_ia_id` é FK única. O modelo correto é N:N (`camera_modelo_ia`). Anote antes que vire cobrança errada.
- **Não existe papel AUDITOR.** A persona está no pitch deck; `papel_usuario` só tem GESTOR e ENGENHEIRO. Um terceiro papel somente-leitura é a evolução natural.
- **Sem tabela de notificação.** As transições deveriam avisar responsável, executor e verificador. Quando entrar: grave na mesma transação (é dado) e envie **depois do commit** (é efeito externo).
- **Fases 4, 5 e 6 sem e2e.** A cobertura nova é unitária (`dominio.spec.ts`) + SQL direto contra as migrations reais via PGlite (`dispositivo-sql.spec.ts`, `painel-sql.spec.ts`, e os describes correspondentes em `invariantes.spec.ts`) + um boot smoke-test. Nenhuma requisição HTTP de verdade foi feita contra `/dispositivo/*`, `/cameras/*`, `/evidencias`, `/obras`, `/locais`, `/modelos-ia`, `/requisitos-norma` ou `/painel/resumo` — nem via Swagger, nem via e2e, nem sequer uma chamada real ao `PainelService` via TypeORM. Antes de confiar nelas para a demo, exercite manualmente com o Postgres do Docker de pé (ver seção 7) e considere escrever e2e para o caminho feliz de cada rota nova.
- **Upload de evidência nunca rodou de verdade.** Nem contra disco local nem contra S3/R2 — só foi lido, nunca executado (sem Postgres não há como persistir a linha de `evidencia` depois do upload). Testar isso é o primeiro passo antes de usar em campo.
- **`CameraHeartbeatScheduler` roda a cada 30s fixo**, não configurável por env — só o timeout (`CAMERA_HEARTBEAT_TIMEOUT_SEGUNDOS`) é. Se a frota crescer muito, revisitar.
- **Checagem de escopo de dispositivo é inline**, repetida nos dois métodos de `DispositivoController` (`exigirEscopo`). Virou decorator + guard só se aparecer uma terceira rota de dispositivo — hoje seria abstração sem uso real.
- **Rate limit de dispositivo é em memória, por processo.** Com mais de uma instância da API atrás de um load balancer, cada instância tem sua própria janela — o limite efetivo vira `120 × instâncias`. Suficiente para a POC; um deploy multi-instância precisa de um contador compartilhado (Redis).
- **`Relatorio`/`RelatorioItem` continuam sem CRUD.** Entidade e índices existem desde a Fase 2; a Fase 5 só cobriu o painel de indicadores, não geração/persistência de relatório — ver seção 5.
- **`.env` local foi gerado neste ambiente** (gitignorado, não commitado) só para o boot smoke-test — com segredos aleatórios, sem relação com nenhum ambiente real. Gere os seus antes de usar em produção.

---

## 9. Monitoramento AWS (EPI/fissura) — feed ao vivo, fora do fluxo de fases

Adição posterior à Fase 6, a partir de `ARQUITETURA_AWS.md` (arquitetura de um
pipeline **separado**: Raspberry Pi → S3 → SQS → serviço de inferência
externo, fora deste backend → S3 → SQS → aqui). Decisão de escopo: feed
visual ao vivo, **sem gravar nada no banco** — não vira `Deteccao`/NC. Se um
dia precisar virar dado real do sistema de qualidade, ver a opção descartada
na época (provisionar a Raspberry Pi como `Camera` e os modelos EPI/fissura
como `ModeloIa`).

**Entregue**: `src/monitoramento/` — `SqsConsumidorService` (long-polling em
`fila-resultados-web`, `WaitTimeSeconds: 20`) extrai bucket+chave do evento S3
da mensagem, busca o `.json` em `processed/`, gera URL pré-assinada da `.jpg`
correspondente, e empurra pro front via `GET /monitoramento/eventos` (SSE).
A mensagem só é apagada da fila em **sucesso**; em erro fica pra o SQS
reentregar sozinho depois do visibility timeout (pedido explícito de
`prompt_para_backend_web.md` — falha transitória não deve virar mensagem
perdida). Rota `@Publico()` com guard próprio (`SseAuthGuard`) que aceita o
JWT por query string (`?token=`), porque o `EventSource` do navegador não
manda header — as demais rotas continuam só com Bearer no header. Config toda
opcional (`MONITORAMENTO_AWS_*` no `.env`): sem credencial, o consumidor loga
um aviso e não inicia, a API sobe normal.

Front: `src/lib/api/monitoramento.ts` abre o `EventSource`; painel novo
(`LiveFeedMonitoramento`) no topo de `/monitoring` mostra o frame mais
recente em destaque (a "câmera ao vivo" é a imagem trocando a cada novo
evento, não vídeo contínuo — ~1 a cada 2-3s), um histórico curto abaixo, e
dispara toast quando `alertas` vem preenchido.

**Não verificado**: não há credencial AWS real neste ambiente (as duas
variáveis `MONITORAMENTO_AWS_ACCESS_KEY_ID`/`SECRET_ACCESS_KEY` ficaram vazias
de propósito — nunca cole segredo em texto no repo). Confirmado só até onde
dá sem nuvem: typecheck, lint, os 116 testes, boot smoke-test (o
`MonitoramentoModule` resolve na árvore de DI — mas o `onModuleInit` do
`SqsConsumidorService`, que logaria o aviso de credencial ausente, nunca
chega a rodar aqui porque o boot trava antes, na conexão com o Postgres) e o
painel testado ao vivo no navegador mostrando "aguardando conexão" sem
quebrar. Preencha as credenciais de `web-backend-epis` e rode local com
Postgres de pé para validar de ponta a ponta.
