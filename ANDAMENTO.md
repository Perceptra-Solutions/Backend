# Andamento do backend — o que foi feito e como continuar

Documento de passagem. O [README.md](README.md) explica como rodar; este explica **o que existe, por quê está assim, e o que fazer a seguir**.

Última atualização: 29/08/2026 · Fases 1, 2 e 3 concluídas · 104 testes passando.

---

## 1. Estado atual em uma tela

| Fase | Escopo | Estado |
|---|---|---|
| 1 | Fundação: config, contrato de erro, bootstrap, health | ✅ |
| 2 | Banco: 14 entidades, 3 migrations, seed, Docker | ✅ |
| 3 | Auth + ciclo da qualidade (o núcleo do desafio) | ✅ |
| 4 | Ingestão de detecções + evidências | ⬜ |
| 5 | Painel de conformidade + relatórios | ⬜ |
| 6 | CRUD de cadastros, rate limit, acabamento | ⬜ |

**26 endpoints no ar.** Testes: 87 unitários (sem banco) + 17 e2e (contra Postgres real).

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

E as três regras que destroem trabalho silenciosamente, repetidas do README: **nunca `synchronize: true`**, **nunca plugin esbuild/swc no Vitest**, **nunca glob de entities**.

---

## 5. O que falta, em ordem

### Fase 4 — Ingestão e evidências

O que mais impressiona tecnicamente. A câmera Perceptra One roda **edge e opera offline**, então rajada não é exceção: é o caso normal.

**4.1 Identidade do dispositivo** — hoje a câmera não tem como se autenticar.
- Migration: `credencial_dispositivo` (prefixo UNIQUE, `hash_sha256`, escopos, `revogada_em`, `ultimo_uso_em`)
- `ApiKeyGuard`: formato `pcr_<prefixo>_<32 bytes>`, hash SHA-256 com pepper (**não** bcrypt — o segredo tem 256 bits aleatórios e o hash é conferido a cada POST; um KDF lento seria o gargalo), comparação com `timingSafeEqual`, cache em memória de 60s
- `POST /cameras/:id/credenciais` emite e mostra a chave **uma vez**
- O `JwtAuthGuard` já ignora tokens com prefixo `pcr_` — a base está pronta

**4.2 Ingestão em lote** — `POST /dispositivo/deteccoes`
- Lote de 1 a 100, corpo limitado a 1 MB. Imagem **nunca** em base64 aqui
- Dedup pela chave natural: `ON CONFLICT (camera_id, id_externo) DO NOTHING RETURNING id`. **A coluna e o índice parcial já existem** — é o que salva a câmera que ficou 3h sem rede
- Validar `ocorrido_em` entre `now()-7d` e `now()+5min` (relógio do edge desviado envenena as séries temporais)
- `confianca < modelo.limiar_confianca` → descartada, **não gravada, e não é erro**
- Resposta `201` com contadores (`aceitas`, `duplicadas`, `descartadas_por_limiar`, `rejeitadas[]`), não `207`
- Rotas em `/dispositivo/*` **sem `:cameraId` no path**: a câmera vem da credencial, o que elimina IDOR por construção

**4.3 Evidências**
- `ArmazenamentoPort` como **`abstract class`** (interface some no emit e o Nest não resolve)
- `ArmazenamentoS3` com `@aws-sdk/client-s3` (já instalado) + presigner; `ArmazenamentoLocal` como fallback
- `FileInterceptor` com **`diskStorage`, nunca `memoryStorage()`** — 200 MB de vídeo viram 200 MB de heap
- SHA-256 em streaming: `pipeline(createReadStream(tmp), createHash('sha256'))`
- Chave por conteúdo: `evidencias/{sha[0:2]}/{sha[2:4]}/{sha}.{ext}` — dedup de graça
- `Content-Type` de saída da allowlist do banco, **nunca** do que o cliente declarou
- `GET /evidencias/:id/integridade` recalcula e compara — é **a** prova da cadeia de custódia na demo
- Upload sempre aninhado ao dono, para o CHECK "nada de evidência órfã" valer por construção

**4.4 Câmera**
- AES-256-GCM em `url_stream`, envelope `enc:v1:<iv>:<tag>:<ct>` — **o CHECK já exige esse prefixo**, mas ninguém cifra ainda. A chave já está validada no boot (`CAMERA_URL_STREAM_ENC_KEY`)
- `POST /dispositivo/heartbeat` + `@nestjs/schedule` marcando `OFFLINE` por `ultimo_heartbeat`

### Fase 5 — Painel e relatórios

`GET /painel/resumo` devolve todos os cards em **uma** requisição. Repositório de leitura próprio, sem passar pelos módulos de escrita.

Indicadores: NCs abertas por severidade e por categoria de norma, **prazo vencido**, tempo médio de fechamento, **taxa de reincidência** (o número mais relevante para PBQP-H), taxa de falso positivo por modelo/versão, saúde da frota.

Duas regras: todo indicador filtra `status <> 'CANCELADA'` (senão dá para maquiar cancelando NC), e NC sem `requisito_norma_id` entra num bucket `NAO_CLASSIFICADA` em vez de sumir — a contagem vira indicador da qualidade do processo.

Os índices parciais que essas consultas exigem **já existem** (`ix_nc_abertas`, `ix_deteccao_pendente`, `ix_camera_heartbeat`).

### Fase 6 — Cadastros e acabamento

CRUD de obra, local, câmera, modelo de IA e requisito de norma. Todas as entidades existem; falta module/controller/service. Use `usuario.service.ts` como molde — é o padrão do projeto.

Rate limit por credencial (guard próprio de ~40 linhas; `@nestjs/throttler` dá ERESOLVE com Nest 12).

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

- **Nada foi commitado.** A árvore inteira está sem versionar.
- **Escopo por obra não existe.** Qualquer usuário autenticado vê NC de qualquer obra. O plano decidiu deixar `usuario_obra` fora da POC, mas isso é um furo de autorização apresentado como feature — vale dizer em voz alta na apresentação, não esconder.
- **Câmera roda um modelo só.** O deck vende por módulo de IA ("Starter = 1 módulo, Professional = 2"), mas `camera.modelo_ia_id` é FK única. O modelo correto é N:N (`camera_modelo_ia`). Anote antes que vire cobrança errada.
- **Não existe papel AUDITOR.** A persona está no pitch deck; `papel_usuario` só tem GESTOR e ENGENHEIRO. Um terceiro papel somente-leitura é a evolução natural.
- **Sem tabela de notificação.** As transições deveriam avisar responsável, executor e verificador. Quando entrar: grave na mesma transação (é dado) e envie **depois do commit** (é efeito externo).
