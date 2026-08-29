# Andamento do backend — o que foi feito e como continuar

Documento de passagem. O [README.md](README.md) explica como rodar; este explica **o que existe, por quê está assim, e o que fazer a seguir**.

Última atualização: 29/08/2026 · Fases 1–7 concluídas · 149 testes unitários + 132 e2e passando.

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
| 7 | Relatório PBQP-H: geração, snapshot, hash, integridade | ✅ |

**63 endpoints no ar.** Testes: **149 unitários** (sem banco, PGlite em
processo) + **132 e2e** contra Postgres real.

> **Fases 4–7 validadas contra Postgres real em 29/08/2026.** O aviso que
> ficava aqui — "Fases 4-6 nunca rodaram contra banco de verdade" — está
> resolvido. O que foi feito: `docker compose up -d`, migrations aplicadas nos
> dois bancos (dev e teste estavam parados na 3ª de 4), `npm run test:e2e`
> (132/132) e exercício manual de cada rota nova via HTTP, incluindo upload de
> evidência com conferência de hash e ingestão de dispositivo com credencial
> real. **Uma falha real apareceu nessa validação** — ver "A dedup que contava
> errado" na seção 4.

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

### Fase 4 — o que foi entregue (coberta por e2e desde 29/08/2026)

**4.1 Identidade do dispositivo** — `src/catalogo-ia/`
- `credencial_dispositivo` (migration `1756400003000-CredencialDispositivo`): `prefixo` UNIQUE, `hash_secreto` char(64) com CHECK de formato hex, `escopos text[]`, `revogada_em`, `ultimo_uso_em`. FK para `camera` com `ON DELETE RESTRICT`.
- Formato da chave: `pcr_<prefixo-12-hex>_<segredo-base64url-32-bytes>`. Geração/hash/conferência em `dominio/credencial-dispositivo.util.ts` (puro, 8 testes).
- **Achado pelo próprio teste, não por revisão manual**: base64url usa `_` como caractere válido (62/63 do alfabeto) — um `chave.split('_')` ingênuo quebra sempre que o segredo sorteado contém underscore (comum, ~1 em cada poucas gerações). `analisarChave()` corta só nos dois primeiros `_`, tratando o resto como segredo inteiro. Sem o teste `analisarChave separa prefixo e segredo de uma chave valida`, isso teria passado no code review e falhado de forma intermitente em produção.
- `ApiKeyGuard` (`catalogo-ia/guards/api-key.guard.ts`): cache em memória de 60s por prefixo, `timingSafeEqual` na comparação, atualiza `ultimo_uso_em` best-effort (nunca bloqueia a resposta).
- `POST /cameras/:id/credenciais` (GESTOR) emite e mostra a chave uma vez. `POST /cameras/:id/credenciais/:credencialId/revogacao` revoga.
- Sem sistema de escopos genérico (Reflector + decorator): só 2 rotas usam escopo (`deteccao:ingerir`, `heartbeat:enviar`), checado inline no controller — um decorator dedicado seria over-engineering para 2 usos.

**4.2 Ingestão em lote** — `src/dispositivos/`
- `POST /dispositivo/deteccoes`: 1–100 itens, sem campo de imagem no DTO (não é possível mandar blob mesmo tentando). Sem middleware de limite de corpo próprio — o body-parser JSON global do Nest (100kb) já é mais apertado que o 1MB do plano original, e é folgado para 100 detecções sem imagem.
- Dedup via `ON CONFLICT DO NOTHING` (sem alvo explícito — cobre o índice parcial existente). A contagem sai de **`raw.length`** — as linhas que o `RETURNING` devolveu. Nunca `identifiers.length`, que com `orIgnore()` é o tamanho do array de entrada e fazia `duplicadas` dar 0 sempre; ver "A dedup que contava errado" na seção 4.
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

**Verificação**: typecheck, lint, unitários e, desde 29/08/2026,
`test/dispositivo-ingestao.e2e-spec.ts` — 16 casos contra Postgres real
cobrindo emissão de credencial, escopo, revogação, dedup, limiar, janela de
tempo e heartbeat. O upload de evidência foi exercitado ponta a ponta pelo
driver local (upload → hash → `/integridade` → download byte a byte
idêntico). **Ainda não feito**: upload contra S3/R2 real.

### Fase 5 — Painel (coberto por e2e desde 29/08/2026)

**`GET /painel/resumo`** (`src/painel/`) — todos os cards do dashboard numa unica requisicao, filtravel por `obraId`:

- NCs abertas por severidade e por categoria de norma (NC sem `requisito_norma_id` cai no bucket `NAO_CLASSIFICADA`, nunca some da contagem).
- NCs com prazo vencido (nao-terminal e `prazo < now()`).
- Tempo medio de fechamento em horas — so `RESOLVIDA` entra; `CANCELADA` tambem tem `fechada_em` mas nao conta como fechamento de qualidade.
- Taxa de reincidencia — `reincidencia_de_id` preenchido / total, com `status <> 'CANCELADA'` no denominador.
- Taxa de falso positivo por modelo/versao de IA — `FALSO_POSITIVO` / triadas (exclui `PENDENTE`, que ainda nao foi julgada), isolado por `modelo_ia_id` para um modelo ruim nao se diluir na media geral.
- Saude da frota — contagem de cameras por `status`.

`PainelModule` nao importa `QualidadeModule`/`CatalogoIaModule`/`IngestaoModule`: registra as mesmas entidades via `forFeature` (regra 4 da secao 6) e le com `QueryBuilder`, incluindo um `LEFT JOIN` cru em `requisito_norma` (sem relacao TypeORM) para a categoria. As agregacoes usam os indices `ix_nc_abertas`, `ix_deteccao_pendente` e `ix_camera_heartbeat` ja existentes desde a Fase 2.

**Verificação em duas camadas, e as duas fazem falta.** `painel-sql.spec.ts`
roda cada agregação como SQL crua contra as migrations via PGlite — pega erro
de sintaxe, cast ou `GROUP BY` sem precisar de Docker. `test/painel.e2e-spec.ts`
(25 casos) exercita o `PainelService` de verdade: QueryBuilder gerando o SQL,
camelCase→snake_case, `COUNT(*) FILTER`, `EXTRACT(EPOCH ...)` e o LEFT JOIN
cru em `requisito_norma`.

Não é redundância. A distância entre "a SQL está certa" e "o serviço traduz o
resultado certo" foi exatamente onde o bug da dedup se escondeu (seção 4). Os
números do e2e são **prováveis** porque toda a massa vive numa obra criada
pelo próprio teste e consultada sempre com `?obraId=` — o seed continua no
banco e serve para provar que o filtro isola.

Duas mutações confirmaram que a suíte tem dentes: remover o `COALESCE` do
bucket `NAO_CLASSIFICADA` e incluir `CANCELADA` no tempo médio de fechamento
quebram um teste cada, nominalmente.

**Relatorio (`Relatorio`/`RelatorioItem`) ficou fora da Fase 5** — o escopo original só descrevia o painel de indicadores. Foi implementado depois, na Fase 7 (ver abaixo).

### Fase 6 — Cadastros e rate limit (coberto por e2e desde 29/08/2026)

CRUD completo (criar, listar, detalhar, atualizar — sem exclusao, mesmo raciocinio do `usuario.service.ts`: FKs `RESTRICT` protegem quem tem dependente) para as cinco entidades que so tinham `*.entity.ts`:

- **`ObrasModule`** (novo) — `Obra` (`/obras`) e `Local` (`/locais`, filtra por `obraId`). `obraId` de um local nao muda depois de criado.
- **`NormasModule`** (novo) — `RequisitoNorma` (`/requisitos-norma`).
- **`CatalogoIaModule`** (estendido) — `ModeloIa` (`/modelos-ia`): `AtualizarModeloIaDto` so expoe `ativo` e `limiarConfianca`, porque o trigger `trg_modelo_ia_imutavel` bloqueia UPDATE de qualquer outra coluna — versao publicada e imutavel, nova versao e linha nova.
- **`CatalogoIaModule`** (estendido) — `Camera` ganhou `POST/GET/GET:id/PATCH:id` em `/cameras`. `urlStream` continua fora de `CriarCameraDto`/`AtualizarCameraDto`: so `PATCH :id/stream` (Fase 4) grava, sempre cifrado. `status` no PATCH permite marcar `MANUTENCAO` manualmente; `OFFLINE` por falta de heartbeat continua automatico via `CameraHeartbeatScheduler`.

Nenhum dos services acima valida a existencia de `obraId`/`localId`/`modeloIaId` antes de gravar — de proposito, seguindo a regra 1 da secao 6 (`FK não é dependência de módulo`): a FK real (ja criada desde a migration Init) faz a checagem, e o `erro-postgres.mapper.ts` traduz `23503`/`23001` em `422`/`409`. Entradas novas foram adicionadas em `MENSAGEM_POR_CONSTRAINT` para as constraints de unicidade e CHECK dessas cinco entidades.

**Rate limit por credencial** (`src/dispositivos/guards/rate-limit-dispositivo.guard.ts`, ~50 linhas) — janela fixa de 60s em memoria, 120 requisicoes por credencial, aplicado com `@UseGuards(ApiKeyGuard, RateLimitDispositivoGuard)` em `POST /dispositivo/deteccoes` e `POST /dispositivo/heartbeat`. Chaveado por `credencialId` (nao por IP: varias cameras de uma obra saem pelo mesmo NAT). `@nestjs/throttler` continua fora do `package.json` — da `ERESOLVE` com Nest 12 nesta arvore, exatamente como o plano original previa.

**Verificação**: `test/cadastros.e2e-spec.ts` — 54 casos contra Postgres
real, cobrindo os cinco cadastros. Duas decisões do projeto só podem ser
verificadas aqui:

- **"FK não é dependência de módulo"** (regra 1 da seção 6). Nenhum service
  valida `obraId`/`localId`/`modeloIaId` antes de gravar; quem checa é a FK,
  e o mapper traduz o `23503` em 422 `REFERENCIA_INVALIDA`. Sem banco real
  não existe `23503` nenhum — esse caminho inteiro só existe no e2e.
- **Unicidade vira 409 com código próprio**, traduzida do `23505` pelo nome
  da constraint (`CODIGO_OBRA_DUPLICADO`, `CODIGO_LOCAL_DUPLICADO`,
  `MODELO_VERSAO_DUPLICADA`, `IDENTIFICADOR_CAMERA_DUPLICADO`,
  `REQUISITO_NORMA_DUPLICADO`).

Também travados aqui: `urlStream` não entra no cadastro, nunca sai na
resposta e fica cifrada (`enc:v1:`) no banco; `obraId` não muda em local nem
em câmera; e versão de modelo publicada não aceita reescrita de nome/versão.
Desligar `forbidNonWhitelisted` derruba 6 destes testes — a proteção contra
mass assignment está de fato coberta.

### Fase 7 — Relatório PBQP-H

`src/relatorios/` deixou de ter só as duas entidades. O relatório é um
**snapshot**: as NCs que atendem aos filtros no instante da geração viram
linhas de `relatorio_item`, na ordem em que aparecem no documento, e o
arquivo gerado é hasheado e guardado. Regerar depois não altera um
relatório já emitido — é essa imutabilidade que o torna utilizável numa
auditoria.

| Rota | O que faz |
|---|---|
| `POST /relatorios` | gera (só GESTOR — quem emite assina por ele) |
| `GET /relatorios` | lista, filtrando por obra e tipo |
| `GET /relatorios/:id` | detalhe com as NCs congeladas, na ordem persistida |
| `GET /relatorios/:id/arquivo` | baixa o documento |
| `GET /relatorios/:id/integridade` | recalcula o hash a partir do storage |

**HTML, não PDF.** Nenhuma biblioteca de PDF entra no `package.json` só por
isso, e o navegador imprime o arquivo em PDF com fidelidade (há `@media
print` no documento). O que o PBQP-H exige é conteúdo rastreável e íntegro —
e o SHA-256 vale igual em HTML.

**O documento é função pura** (`dominio/documento-relatorio.ts`), como
`qualidade/dominio/`: 18 testes em milissegundos, sem Nest e sem banco.
Ele nunca chama `new Date()` — tudo que varia entra por parâmetro.

**Determinismo não é capricho aqui.** A ordem calculada vira
`relatorio_item.ordem`, que é persistido, e o arquivo é endereçado por
conteúdo (`relatorios/{aa}/{bb}/{sha}.html`). Duas gerações do mesmo recorte
precisam produzir os mesmos bytes, ou o hash deixa de provar o conteúdo. Por
isso a ordenação desempata até o fim (severidade → abertura → código, que é
único) e as datas saem em ISO/UTC — `toLocaleString` mudaria os bytes com a
locale da máquina.

**Ordem de escrita deliberada**: monta o conteúdo → hasheia → grava no
storage → **só então** abre a transação que insere `relatorio` +
`relatorio_item`. Se a transação falhar depois do upload, sobra um objeto
órfão e reaproveitável (o endereço é o próprio hash) — nunca uma linha no
banco apontando para arquivo inexistente, que é o modo de falha que
quebraria a verificação de integridade.

**Wart conhecido**: no driver local os relatórios caem em
`storage/evidencias/relatorios/`, porque a raiz do storage vem de
`EVIDENCIA_STORAGE_PATH` — a variável nasceu quando só havia evidência.
Funciona e fica isolado no seu próprio subdiretório; renomear a variável
quebraria `.env` e `docker-compose.yml` de quem já tem o projeto rodando.

`RelatoriosModule` não importa `QualidadeModule`/`ObrasModule`/`NormasModule`
(regra 4 da seção 6): registra `NaoConformidade` e `Obra` no próprio
`forFeature` e lê com QueryBuilder, com join cru em `requisito_norma`,
`local` e `usuario` — mesmo padrão do `PainelModule`.

**Verificação**: 18 unitários do documento + 9 invariantes de schema novas
(`invariantes.spec.ts`, describe `relatorio`) + 19 e2e contra Postgres real,
incluindo a asserção de que a ordem impressa no HTML é a mesma persistida em
`relatorio_item.ordem` e que o hash gravado bate com o arquivo que sai pelo
download. Gerado ao vivo pelo container: 12 NCs, hash conferido.

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

| **`InsertResult.identifiers` não encolhe com `orIgnore()`** | a API dizia `aceitas: 1, duplicadas: 0` para um lote inteiramente duplicado — o banco descartava certo, a resposta é que mentia | conte por `raw.length` (linhas do `RETURNING`), nunca por `identifiers.length`; ver abaixo |
| **`new Date()` no argumento vs. no default do parâmetro** | `painel-sql.spec.ts` falhava ~1 em 3 execuções **sob carga** com `ck_nc_fechada_apos_abertura` violado; passava sempre com a máquina ociosa | o `new Date()` do argumento roda antes do `new Date()` do default. Empatam no mesmo ms quase sempre — até a máquina engasgar entre os dois. Fixe o instante uma vez, ou dê folga explícita (`aberta_em` = 1h atrás) |

E as três regras que destroem trabalho silenciosamente, repetidas do README: **nunca `synchronize: true`**, **nunca plugin esbuild/swc no Vitest**, **nunca glob de entities**.

### A dedup que contava errado — e por que os testes não pegaram

Vale contar inteiro, porque o erro não estava onde se procurava.

`POST /dispositivo/deteccoes` respondia `{"aceitas":1,"duplicadas":0}` para
um lote cujos itens já existiam. O índice único parcial funcionava: o banco
tinha uma linha só. A SQL estava certa. O que estava errado era a leitura do
resultado:

```ts
aceitas = inseridas.identifiers.length;   // sempre = candidatas.length
aceitas = inseridas.raw.length;           // linhas que o RETURNING devolveu
```

Isolando contra Postgres real, o comportamento é inequívoco:

```
1ª inserção: identifiers=[{id}] | raw.length=1   ← inseriu
2ª inserção: identifiers=[{id}] | raw.length=0   ← ON CONFLICT ignorou
linhas no banco: 1
```

Com `orIgnore()` o TypeORM monta `identifiers` a partir do array de
**entrada**, não do `RETURNING` — então `identifiers.length` era
`candidatas.length` disfarçado, e `duplicadas` (calculado por subtração)
dava 0 sempre.

Três camadas de teste passaram por cima disso:

- **`dispositivo-sql.spec.ts`** testava a SQL crua e afirmava, corretamente,
  que a segunda inserção retorna zero linhas. A SQL nunca esteve errada.
- **O `ANDAMENTO` anterior documentava a contagem como decisão pensada**
  ("contagem por `identifiers.length`, não por mapeamento posicional"), o
  que fez a linha *parecer* revisada.
- **Nenhum e2e tocava a rota**, porque as Fases 4–6 nunca tinham rodado
  contra banco de verdade.

A lição: um teste de SQL crua valida o *banco*, não o *serviço*. Onde a
camada de acesso a dados traduz um resultado, só o caminho real revela a
tradução errada. `test/dispositivo-ingestao.e2e-spec.ts` existe exatamente
para travar isto — e o caso `conta a reentrega do mesmo idExterno como
duplicada` falha na versão antiga.

---

## 5. O que falta, em ordem

As Fases 1–7 estão concluídas e validadas contra Postgres real. Três itens
que ocupavam esta seção foram fechados em 29/08/2026: "validar Fases 4–6
contra banco de verdade", "definir e implementar o relatório" e "e2e para o
painel e para os cadastros". **Toda rota da API tem cobertura e2e agora.**

O que resta, em ordem de valor:

1. **Upload de evidência contra S3/R2 de verdade.** O caminho local está
   verificado ponta a ponta (upload → hash → integridade → download byte a
   byte idêntico). O driver `s3` nunca rodou contra bucket real.
2. **Credencial AWS do monitoramento.** `MONITORAMENTO_AWS_ACCESS_KEY_ID` e
   `SECRET_ACCESS_KEY` estão vazias no `.env` — o consumidor da fila não
   inicia e o feed ao vivo fica desligado (a API sobe normal, com aviso no
   log). Preencher com a credencial de `web-backend-epis` é o que falta para
   validar a seção 9 de ponta a ponta.
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

`npm test` não precisa de banco (149 casos). Para o e2e (132 casos), o Postgres
do container precisa estar de pé e o banco de teste migrado:

```bash
docker compose run --rm -e DATABASE_URL="postgresql://perceptra:perceptra@postgres:5432/qualidade_obra_test" migracao
```

```bash
npm run test:e2e
```

Duas armadilhas de ambiente que custaram tempo em 29/08/2026, ambas com o
mesmo sintoma ("o código está certo mas a API responde errado"):

- **`node_modules` fora de sincronia com o lock.** `npm run typecheck`
  acusava `@nestjs/schedule` e `@aws-sdk/client-sqs` inexistentes, embora
  ambos estivessem no `package-lock.json` commitado. Um `npm install` local
  resolve; num clone novo o `npm ci` nunca teria o problema.
- **Container antigo segurando a porta 3000.** O `perceptra-api` sobe com
  `restart: unless-stopped` e volta junto com o Docker Desktop, com a imagem
  de quando foi construído. Rodar `node dist/main.js` local *parece*
  funcionar — mas `localhost:3000` resolve para o container, e rotas novas
  dão **404** com um código que as tem. Se ver 404 em rota que existe:
  `docker ps` primeiro, depois `docker compose up -d --build`.

---

## 8. Pendências conhecidas

- **Escopo por obra não existe.** Qualquer usuário autenticado vê NC de qualquer obra. O plano decidiu deixar `usuario_obra` fora da POC, mas isso é um furo de autorização apresentado como feature — vale dizer em voz alta na apresentação, não esconder.
- **Câmera roda um modelo só.** O deck vende por módulo de IA ("Starter = 1 módulo, Professional = 2"), mas `camera.modelo_ia_id` é FK única. O modelo correto é N:N (`camera_modelo_ia`). Anote antes que vire cobrança errada.
- **Não existe papel AUDITOR.** A persona está no pitch deck; `papel_usuario` só tem GESTOR e ENGENHEIRO. Um terceiro papel somente-leitura é a evolução natural.
- **Sem tabela de notificação.** As transições deveriam avisar responsável, executor e verificador. Quando entrar: grave na mesma transação (é dado) e envie **depois do commit** (é efeito externo).
- **Id malformado no path devolve 400; corpo e query devolvem 422.** Dois códigos para a mesma classe de erro. `criarValidationPipe()` define `errorHttpStatusCode: UNPROCESSABLE_ENTITY`, mas os 48 `ParseUUIDPipe` dos parâmetros de rota usam o default do Nest (BadRequest). Uniformizar é passar `new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY })` nos 48 — mudança de contrato público, decisão de quem mantém a API. Enquanto não se decide, `cadastros.e2e-spec.ts` fixa o comportamento atual com um teste nomeado, para a divergência ser escolha visível e não surpresa para o front.
- **Upload de evidência: local verificado, S3 não.** O caminho local roda ponta a ponta (upload → SHA-256 → `/integridade` → download byte a byte idêntico). Contra S3/R2 nunca foi executado.
- **`CameraHeartbeatScheduler` roda a cada 30s fixo**, não configurável por env — só o timeout (`CAMERA_HEARTBEAT_TIMEOUT_SEGUNDOS`) é. Se a frota crescer muito, revisitar.
- **Checagem de escopo de dispositivo é inline**, repetida nos dois métodos de `DispositivoController` (`exigirEscopo`). Virou decorator + guard só se aparecer uma terceira rota de dispositivo — hoje seria abstração sem uso real.
- **Rate limit de dispositivo é em memória, por processo.** Com mais de uma instância da API atrás de um load balancer, cada instância tem sua própria janela — o limite efetivo vira `120 × instâncias`. Suficiente para a POC; um deploy multi-instância precisa de um contador compartilhado (Redis).
- **Relatório sai em HTML, não em PDF.** Decisão consciente (ver Fase 7): o navegador imprime em PDF e nenhuma biblioteca nova entra no `package.json`. Se a apresentação exigir PDF gerado no servidor, é aí que entra a dependência — e o hash passa a ser do PDF, não do HTML.
- **Relatório não tem exclusão nem reemissão versionada.** Gerar de novo cria outro relatório; não há vínculo "esta é a versão 2 daquele". Se a auditoria pedir trilha de reemissão, é uma coluna `substitui_id` mais um índice, no mesmo espírito de `reincidencia_de_id`.
- **`.env` local foi gerado neste ambiente** (gitignorado, não commitado) com segredos aleatórios, sem relação com nenhum ambiente real. Gere os seus antes de usar em produção. As chaves conferem 1:1 com o `.env.example`; as duas credenciais AWS estão vazias de propósito.

---

## 9. Monitoramento AWS (EPI/fissura) — feed ao vivo, fora do fluxo de fases

Adição posterior à Fase 6, a partir de `ARQUITETURA_AWS.md` (arquitetura de um
pipeline **separado**: Raspberry Pi → S3 → SQS → serviço de inferência
externo, fora deste backend → S3 → SQS → aqui).

> **O escopo mudou depois.** A decisão original era feed visual ao vivo *sem
> gravar nada no banco*. O commit `92f6357` adicionou
> `PersistenciaDeteccaoService`, que **grava** `Deteccao` + `Evidencia` —
> exatamente a opção que tinha sido descartada (provisionar a Raspberry Pi
> como `Camera` e os modelos EPI/fissura como `ModeloIa`, criados sob demanda
> em `resolverCadastros()`). Só persiste quando `resultado.alertas` não é
> vazio: imagem conforme continua só no feed, sem poluir a fila de triagem.
> `idExterno` é determinístico (`{imagem}#{indice}`), então a reentrega do
> SQS (at-least-once) cai no índice único parcial e não duplica.

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
de propósito — nunca cole segredo em texto no repo). Confirmado até onde dá
sem nuvem: typecheck, lint, os 149 testes, e o boot com Postgres real, onde
o `onModuleInit` do `SqsConsumidorService` **agora chega a rodar** e loga
`MONITORAMENTO_AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY ausentes — feed ao vivo
desligado`, com a API subindo normal. (No smoke-test antigo isso nunca
aparecia, porque o boot travava antes na conexão com o banco.) Preencha as
credenciais de `web-backend-epis` para validar de ponta a ponta.

**Divergência a conferir quando a credencial entrar**: `CLASSE_PARA_CODIGO`
em `persistencia-deteccao.service.ts` mapeia `SEM_COLETE` e `SEM_MASCARA`,
mas o catálogo do `epi-detector` no seed é `['SEM_CAPACETE','SEM_CINTO',
'SEM_LUVA']`. A coluna `classe` é texto livre (sem CHECK), então nada
quebra no banco — mas o front pode não ter rótulo para esses dois códigos.
Alinhe o seed com as classes reais do pipeline Python, ou o mapa com o seed.
