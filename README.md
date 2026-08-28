# Media Livre — Monitor de Newsletters

Protótipo funcional (MVP v3). Lê a caixa de correio de 5 em 5 minutos, identifica
a que newsletter pertence cada email, compara com o que era esperado, atribui um
código de 1 a 6 e mostra tudo numa página.

## O ciclo

```
1. lê a caixa de correio a cada 5 minutos
2. identifica a que newsletter pertence cada email
3. compara com o que era esperado e atribui um código de 1 a 6
4. mostra tudo numa página
```

## Estados

| Código | Designação | Regra |
|---|---|---|
| 1 | Saiu e Tem Conteúdo Atualizado | Dentro da janela, conteúdo diferente do anterior, um só envio |
| 2 | Saiu Atrasada | Chegou depois de `horaPrevista + toleranciaMinutos` |
| 3 | Saiu Duplicada | Dois emails distintos na mesma janela |
| 4 | Saiu com Conteúdo Desatualizado | Hash do texto normalizado igual ao da edição anterior |
| 5 | Não Saiu | Fechou o dia e não chegou nada |
| 6 | Desativada / Não agendada | `ativa: false`, ou hoje não é dia esperado |

Precedência, do mais grave para o menos: **6 → 5 → 3 → 4 → 2 → 1**. O 6 avalia-se
primeiro e faz curto-circuito. O `codigo_estado` tem um `CHECK (BETWEEN 1 AND 6)`
na base de dados: é impossível gravar outra coisa.

## Arrancar

```bash
npm install
cp .env.example .env      # preencher GRAPH_CLIENT_ID e GRAPH_TENANT_ID
npm run migrar            # cria a base de dados e as linhas dos últimos 30 dias
npm run auth              # autentica uma vez, por device code
npm run dev               # http://localhost:3000
```

Sem `npm run auth` a aplicação arranca na mesma: gera os registos e mostra a
página, mas não lê a caixa. É o estado em que fica útil para ver a estrutura
antes de haver acesso ao Graph.

### Registo no Azure

A app precisa de:

- permissão **delegada** `Mail.Read`;
- **Allow public client flows** ativo — sem isto o fluxo *device code* não
  devolve refresh token.

## Preencher as newsletters

`config/newsletters.ts` tem as três entradas. Os campos `remetentes` e
`padraoAssunto` começam vazios e são o único bloqueio: não estão no Excel e têm
de vir de emails reais. Enquanto estiverem vazios, o sistema **recolhe e guarda**
os emails mas não os classifica, e a página mostra um aviso.

Para os descobrir:

```bash
npm run listar    # imprime remetente + assunto das últimas 24 h, sem gravar
```

Depois de preencher, os emails já guardados são reclassificados
automaticamente no ciclo seguinte — o histórico não se perde.

Uma entrada de `remetentes` que comece por `@` vale para todo o domínio
(`@exemplo.pt`). O `padraoAssunto` é uma correspondência por conteúdo, sem
distinção de maiúsculas.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Produção |
| `npm run auth` | Autenticação por device code (uma vez) |
| `npm run listar` | Lista os emails das últimas 24 h na consola, sem gravar |
| `npm run recolher` | Corre um ciclo de recolha à mão |
| `npm run migrar` | Cria a base de dados e tapa buracos nos últimos 30 dias |
| `npm run typecheck` | `tsc --noEmit` |

## Estrutura

```
config/newsletters.ts     as três newsletters, escritas à mão
src/lib/
  tipos.ts                códigos, designações, cores, tipos das tabelas
  tempo.ts                fuso Europe/Lisbon, dias locais, horas de corte
  esquema.ts              o SQL das três tabelas
  db.ts                   ligação SQLite
  conteudo.ts             normalização do corpo e hash (§7.4)
  correspondencia.ts      email → newsletter (§6)
  classificacao.ts        o motor de estados, função pura (§4, §7)
  registos.ts             gerar o dia, reavaliar, fechar, ler para a página
  recolha.ts              gravar emails com deduplicação (§6)
  ciclo.ts                o ciclo de 5 em 5 minutos
  graph/token.ts          refresh token na base de dados
  graph/auth.ts           MSAL, device code, renovação
  graph/mail.ts           leitura da caixa
src/app/
  page.tsx                a página (servidor)
  api/arranque/route.ts   onde os jobs node-cron são registados
  api/ciclo/route.ts      disparo manual do ciclo
  api/gerar-dia/route.ts  disparo manual do job das 00h05
src/components/Painel.tsx a grelha, a matriz e o painel de detalhe
src/instrumentation.ts    arranque — sem imports, ver nota abaixo
```

### Nota sobre o arranque

Os jobs correm dentro do processo do Next (§9), mas **não** são registados no
`instrumentation.ts`. O Next compila esse ficheiro num bundle próprio ao qual o
`serverExternalPackages` não se aplica, e qualquer dependência que toque em
módulos nativos (`better-sqlite3`) ou em `require("crypto")` à moda antiga
(`@azure/msal-node` → `jsonwebtoken`) faz falhar o servidor inteiro.

Por isso o `instrumentation.ts` não tem imports nenhuns: faz um `POST` a
`/api/arranque`, e é essa rota — já do lado do servidor, onde os externos são
respeitados — que regista os dois `node-cron`. Continua a ser um processo único.

## Produção

```bash
npm run build
pm2 start ecosystem.config.cjs
```

Processo único. Sem Docker, sem Postgres, sem proxy.

## O que está fora desta versão

Importação do Excel e do histórico; células com o valor `c`; as restantes 60
newsletters; CRUD de newsletters; autenticação; exportação CSV/XLSX; correções
manuais e auditoria; ecrã de emails não classificados; alertas.
