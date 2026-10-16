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
| 4 | Saiu com Conteúdo Desatualizado | Hash do texto normalizado igual ao da edição anterior, ou exatamente os mesmos artigos (≥ 3) |
| 5 | Não Saiu | Fechou o dia e não chegou nada — só com prova de ausência (ver abaixo) |
| 6 | Desativada / Não agendada | `ativa: false`, ou hoje não é dia esperado |

Precedência, do mais grave para o menos: **6 → 5 → 3 → 4 → 2 → 1**. O 6 avalia-se
primeiro e faz curto-circuito. O `codigo_estado` tem um `CHECK (BETWEEN 1 AND 6)`
na base de dados: é impossível gravar outra coisa.

### Conteúdo repetido

Duas provas, comparadas com a edição anterior efetivamente recebida:

- o **hash** do texto normalizado (sem datas, sem parâmetros de URL; as imagens
  entram com o endereço inteiro, sem cortar números que parecem datas);
- os **artigos**: os links da edição, desembrulhados do tracking (Amazon SES
  `awstrack.me/L0/…`, redirecionadores com `?url=`), sem query nem fragmento, só
  páginas de artigos da marca (fora redes sociais, anúncios, lojas de apps,
  subscrições, secções e página inicial).

Hash igual, ou Jaccard dos artigos = 1 com pelo menos 3 artigos → **4**. Jaccard
≥ `LIMIAR_ARTIGOS` (0,7) e < 1 → o código **não muda**; o detalhe ganha
"⚠ provavelmente repetida: X de Y artigos iguais à edição anterior" e a decisão
fica para quem lê. O assunto nunca conta como prova (a FLASH! Weekend de 15/10
repetiu o assunto da semana anterior com 8 artigos novos).

O limiar foi calibrado com `node scripts/calibrar-artigos.ts <monitor.db>`, que
abre a base só para leitura e imprime o Jaccard de cada par de edições
consecutivas. Em 94 pares (29/09 a 15/10): as duas edições requentadas
conhecidas deram 0,86 (maxima-geral 02/10) e 0,71 (flash-mundo 04/10); a
legítima mais parecida deu 0,67 (negocios-tecnologia 01/10). Voltar a correr com
mais dados antes de mexer no limiar.

O hash e os artigos são recalculados do `corpo_html` a cada reavaliação, dos dois
lados: um `hash_conteudo` gravado com uma normalização antiga nunca é comparado
com um feito com a nova.

### Prova de ausência

Um registo só fecha como **5 — Não Saiu** quando há prova de que a newsletter
não chegou: "a caixa foi lida e não veio nada" não chega (os editores cortam o
envio a caixas inativas). Sem prova fica em aberto (`fechado = 0`) e o painel
e o Excel mostram-no como **Por confirmar** (falta a leitura) ou **Não
recebida – sem prova** (ressalva `sem-prova`), ou **Não assinada no email** se
não tiver remetente, com o detalhe a dizer porquê. A prova exige
(`src/lib/prova.ts`):

1. uma leitura bem-sucedida da caixa depois do limite (mais 10 min de margem),
   com a cobertura contínua das leituras a abranger toda a janela da edição;
2. remetentes configurados;
3. pelo menos um email da newsletter recebido **antes** desse dia (prova de
   que a caixa está inscrita);
4. nenhum email por atribuir, na janela da edição, que possa ser dela — do
   mesmo remetente configurado, ou com a marca e o nome (ou o padrão do
   remetente) no nome ou no assunto. O mesmo domínio com outro endereço não
   conta, para o marketing de assinaturas não travar as gratuitas da marca;
5. um **canário**: outro email do mesmo remetente (endereço ou domínio)
   chegou nas 24 h depois do limite — que não seja marketing do editor
   (boas-vindas, promoções conhecidas, reconquista): a campanha de
   reconquista chega precisamente quando o editor corta as edições;
6. nenhum email de reconquista do mesmo domínio nos 30 dias anteriores, nem
   nas 24 h do canário. É
   reconhecido pela **estrutura**, não pela redação do assunto
   (`eNaoEdicaoDoEditor`, em `correspondencia.ts`): vem de um endereço de
   edições, não traz marca de edição (nem o bloco `/4196/…_LEADERBOARD`, nem a
   `marcaCorpo` de nenhuma newsletter desse endereço), foi feito no editor de
   campanhas (imagens em `assets.unlayer.com`) e tem menos de 2 000
   caracteres de texto. As boas-vindas ("Bem-vindo(a)…") têm o mesmo molde e
   não contam; os assuntos antigos ("Queremos garantir que continua
   connosco", "Notámos que há algum tempo…") continuam a contar como rede
   extra;
7. menos de 3 edições seguidas em falta (2 nas semanais e mensais).

Enquanto não houver uma leitura que cumpra o ponto 1, o registo mostra-se
**Por confirmar**, nunca "Não recebida": o arranque reavalia os registos antes
de ler a caixa, e com a leitura a falhar o email pode estar lá por ler. Um
email por atribuir que chegue depois de um "Não Saiu" fechado, e possa ser
dele (ponto 4), reabre-o na própria recolha. Um registo que deixe de ser 6
(newsletter reativada, calendário mudado) não herda o `fechado` do 6, e nada
fica fechado antes do limite.

As pagas (`config/pagas.ts`) estão isentas de 2 a 7: a caixa não está inscrita
nelas de propósito e o 5 delas é o grupo de controlo do motor — mostram-se
como **5 Não Saiu (controlo)**, mesmo sem remetente.

Um 1 sem edição anterior comparável mostra-se como **Saiu (sem termo de
comparação)** (ressalva `sem-comparacao`): chegou, mas "conteúdo atualizado"
não está provado. As ressalvas vivem na coluna `registos.ressalva`; o
`codigo_estado` e o seu CHECK não mudam.

### Caixa cortada

Os editores deixam de mandar as diárias a caixas que nunca abrem os emails.
A leitura continua a correr bem, por isso isto não se vê na saúde da leitura.
`src/lib/caixa.ts` mede, por domínio do editor (só gratuitas, ativas, com
remetente), a última edição recebida e quantos dias esperados de uma diária
(diária ou dias úteis, com o limite já passado) passaram sem **nenhuma**
diária desse domínio. Com 2 ou mais, o domínio entra em `caixaCortada`:

```json
"caixaCortada": [{ "dominio": "news.jornalrecord.pt", "desde": "2026-10-06",
                   "ultimaEdicao": "2026-10-05T10:05:48.000Z", "diasEsperadosSemEdicao": 10 }]
```

Vem no `/api/estado` (campos `caixa` e `caixaCortada`, atrás da
palavra-passe do painel) **sem mexer no 200/503**, que continua a depender só
da leitura — é disso que a verificação externa precisa. O `/api/saude` é
público e só traz `saudavel`, `ultimaLeitura`, `minutosDesdeLeitura` e
`falha` (um código genérico, `"leitura_falhou"`, nunca o erro em bruto). O ciclo escreve no log uma linha `CAIXA CORTADA …` quando a
lista muda (e `Caixa normalizada` quando esvazia), sem serviços externos.
Um domínio de que nunca chegou nenhuma diária não conta: não há prova de que
a caixa estivesse inscrita.

### Marcas guardadas à entrada

A identificação precisa de meia dúzia de coisas do corpo (as `marcaCorpo`
que traz, o bloco de publicidade, as imagens do editor de campanhas, o
tamanho do texto). São extraídas uma vez, à entrada, para a coluna
`emails.marcas` (`src/lib/marcas.ts`), e a reclassificação de 5 em 5 minutos
usa-as em vez de reler o `corpo_html` de todos os emails. Bases antigas são
preenchidas no arranque e no ciclo (`garantirMarcas`, idempotente). As marcas
levam a impressão digital das `marcaCorpo` configuradas: mudar uma marca em
`config/newsletters.ts` faz com que sejam extraídas outra vez, uma vez — o
resultado é sempre o mesmo que procurar no HTML. Um índice de cobertura
(`idx_emails_identificacao`) evita que a leitura atravesse as páginas de
overflow dos corpos.

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

### Gmail em vez do Graph

Com `GMAIL_USER` e `GMAIL_APP_PASSWORD` preenchidos no `.env`, a caixa lê-se
por IMAP (caixa de entrada + Spam) e o Graph é ignorado. A palavra-passe de app
cria-se em https://myaccount.google.com/apppasswords e exige a verificação em
dois passos ligada na conta.

### Sempre ligado (pm2)

```bash
npm run build
pm2 start ecosystem.config.cjs   # http://localhost:3001
pm2 save
```

Parar o `npm run dev` antes do build: os dois escrevem em `.next/` e o build
fica com ficheiros em falta (todas as rotas `/api` devolvem 500).

## As newsletters

`config/newsletters.ts` é **gerado** a partir da folha "Horário" do Excel:

```bash
npm run importar -- "C:/caminho/Newsletters Horários.xlsx"
```

São 62 newsletters, 48 ativas. Não editar periodicidades nem horas à mão —
mexer no Excel e voltar a correr o importador, que lê o `.xlsx` diretamente
(sem dependências: um xlsx é um zip, e o `node:zlib` chega para o abrir).

O importador desliga (`ativa: false`) tudo o que não consiga agendar com
segurança — estado que não seja "Ativa", periodicidade que não reconheça, ou
hora em falta — e deixa um comentário por cima da entrada a dizer porquê. É
preferível uma linha a cinzento do que inventar um horário que o Excel não diz.

Onde o Excel tem duas horas ("12h ou 18h", "16h30 // 17h"), toma-se a mais cedo
como prevista e alarga-se a tolerância até cobrir a mais tarde.

### Preencher os remetentes

O Excel não tem esta informação. Os campos `remetentes`, `marcaCorpo`,
`padraoRemetente` e `padraoAssunto` começam vazios e são o único bloqueio: não estão no Excel e têm
de vir de emails reais. Enquanto estiverem vazios, o sistema **recolhe e guarda**
os emails mas não os classifica, e a página mostra um aviso.

Para os descobrir:

```bash
npm run listar    # imprime remetente + assunto das últimas 24 h, sem gravar
```

Depois de preencher, os emails já guardados são reclassificados
automaticamente no ciclo seguinte — o histórico não se perde.

Cada newsletter reconhece-se por:

| Campo | O que é |
|---|---|
| `remetentes` | Endereços aceites. Uma entrada que comece por `@` vale para todo o domínio (`@exemplo.pt`) |
| `marcaCorpo` | Texto que **só as edições** desta newsletter trazem no HTML. É o critério principal (ver abaixo) |
| `padraoRemetente` | Nome do remetente **por inteiro** ("Vidas Geral"), sem distinção de maiúsculas, nunca por pedaço |
| `padraoAssunto` | Pedaço fixo do assunto, sem distinção de maiúsculas |

O endereço tem de bater, e todos os outros campos preenchidos também.

**Porque é que o corpo manda.** As newsletters de cada marca partilham o
endereço (`info@news.jornaldenegocios.pt`, `info@news.flash.pt`…), o assunto é
a manchete do dia, e as editoras mandam marketing — boas-vindas, "volte a
ler-nos", "notámos que não lê" — do **mesmo endereço e com o mesmo nome** de uma
newsletter verdadeira ("FLASH! Mundo", "Máxima", "Jornal de Negócios Opinião do
dia", "Correio da Manhã Bom dia"). A Máxima Geral e a Máxima Fim de Semana
chegam ambas como "Máxima". Endereço e nome não chegam.

O que prova a edição é o bloco de publicidade: toda a edição de CM, Record,
Negócios, FLASH! e Máxima traz
`…/gampad/ad?iu=/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, e
nenhum email de marketing o traz. A `marcaCorpo` dessas newsletters é
`/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD` (a marca conta:
`NEWSLETTER_BOMDIA` existe na CM e na FLASH!). Vidas e MUST não têm o bloco: a
marca é o logótipo do cabeçalho, e exige-se também o nome do remetente. Um
email do remetente certo sem a marca fica **por atribuir** — nunca passa por
edição.

Para descobrir a marca de uma newsletter nova, procurar `MASTHEAD` no HTML de
uma edição (coluna `corpo_html` da tabela `emails`). No HTML aparece umas vezes
com `/` e outras com `%2F`; o matcher aceita as duas.

A lista `ASSUNTOS_NAO_EDICAO` em `src/lib/correspondencia.ts` continua a existir,
mas só para o painel não mostrar o marketing conhecido em "por classificar" —
já não é ela que o impede de contar.

**O importador não apaga estes campos.** `npm run importar` volta a escrever
`config/newsletters.ts`, mas copia `remetentes`, `padraoRemetente`,
`padraoAssunto` e `marcaCorpo` do ficheiro anterior, newsletter a newsletter,
pelo `id`. O único caso em que uma regra se perde é o `id` mudar (o nome mudou
no Excel): o importador lista essas regras no fim, com ATENÇÃO, e sai com erro
— copiam-se à mão para a entrada nova (o ficheiro anterior está também no git).

**Ficam de propósito sem regra:** as pagas (`config/pagas.ts`), que a caixa não
assina — são o grupo de controlo e mostram "Não Saiu" —, e os "… Indica"
(`info@projetos.*`, comércio afiliado, fora de âmbito).

Para confirmar a configuração contra os emails já guardados, só em leitura:

```bash
npm run verificar [caminho/para/monitor.db]
```

Mostra quantos emails cabem a cada newsletter, os que ficam sem dono, os de
marketing ignorados e os que serviriam a mais do que uma regra (tem de ser
zero).

### Pelo painel, sem código: "Por classificar" (`/classificar`)

O topo do painel liga para `/classificar`, onde a equipa trata sozinha os emails
que não contaram para nenhuma newsletter:

1. **Atribuir** — o email mostra a marca de publicidade que traz
   (`/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, com `/` ou `%2F`).
   Escolhe-se a newsletter (vem sugerida quando a marca o permite) e grava-se
   uma regra "endereço do remetente + marca" na tabela `regras_newsletter`.
   Emails sem marca não se podem atribuir (não há prova de que são edição).
2. **Não é newsletter** — ignora o assunto (normalizado) ou só aquela
   mensagem (tabela `exclusoes`). Só tira o email da lista; não mexe em estados.
3. Tudo se pode desfazer na mesma página, e cada alteração fica em
   `alteracoes` (quando, utilizador da autenticação do proxy, o quê).

As regras do painel **somam-se** ao `config/newsletters.ts`, que continua a ser
a base (`src/lib/regras-fusao.ts`, aplicado pelo `db()`): nunca lhe tiram nada.
Numa newsletter que o ficheiro já reconhece, cada regra é uma alternativa
(`alternativas`); numa por configurar, a primeira regra passa a ser o critério
principal. A aplicação nunca escreve no `config/*.ts`.

Uma regra é recusada se algum email guardado passasse a servir a duas
newsletters, se a marca já identificar outra newsletter, ou se o email não
trouxer a marca escolhida. Depois de gravar, os emails são reclassificados e os
registos da newsletter (45 dias) reavaliados — o painel muda logo.

A mesma página mostra, por newsletter ativa, se é reconhecida (ficheiro,
painel ou ambos) e quando chegou a última edição.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Produção |
| `npm run auth` | Autenticação por device code (uma vez) |
| `npm run listar` | Lista os emails das últimas 24 h na consola, sem gravar |
| `npm run recolher` | Corre um ciclo de recolha à mão |
| `npm run migrar` | Cria a base de dados e tapa buracos nos últimos 30 dias |
| `npm run importar -- <xlsx>` | Regera `config/newsletters.ts` a partir do Excel (preserva os remetentes) |
| `npm run verificar [db]` | Corre a correspondência sobre os emails guardados, só em leitura |
| `npm run typecheck` | `tsc --noEmit` |

## Estrutura

```
config/newsletters.ts     as 62 newsletters — GERADO, não editar à mão
src/lib/
  tipos.ts                códigos, designações, cores, tipos das tabelas
  tempo.ts                fuso Europe/Lisbon (fixo, nunca o TZ do servidor), dias locais, horas de corte
  esquema.ts              o SQL das três tabelas
  db.ts                   ligação SQLite
  conteudo.ts             normalização do corpo e hash (§7.4)
  correspondencia.ts      email → newsletter (§6); marketing do editor pela estrutura
  marcas.ts               marcas do corpo extraídas à entrada (emails.marcas)
  prova.ts                prova de ausência (quando "nada chegou" é "Não Saiu")
  caixa.ts                caixa cortada pelo editor (dias sem diárias por domínio)
  saude.ts                o que o /api/saude (público) e o /api/estado devolvem
  seguranca.ts            CSP das páginas com HTML de terceiros, limpeza do
                          HTML dos emails, recusa de pedidos de outra origem
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
  api/estado/route.ts     estado em detalhe (erro da leitura, caixa por editor)
src/middleware.ts         recusa POST/PUT/… vindos de outra origem (CSRF)
src/components/Painel.tsx a grelha, a matriz semanal e o painel de detalhe
src/instrumentation.ts    arranque — sem imports, ver nota abaixo
scripts/importar-horario.ts  gera a config a partir do Excel
scripts/calibrar-artigos.ts  Jaccard dos artigos entre edições, só leitura
```

### Nota sobre o arranque

Os jobs correm dentro do processo do Next (§9), mas **não** são registados no
`instrumentation.ts`. O Next compila esse ficheiro num bundle próprio ao qual o
`serverExternalPackages` não se aplica, e qualquer dependência que toque em
módulos nativos (`better-sqlite3`) ou em `require("crypto")` à moda antiga
(`@azure/msal-node` → `jsonwebtoken`) faz falhar o servidor inteiro.

Por isso o `instrumentation.ts` não tem imports nenhuns: faz um `POST` a
`/api/arranque`, e é essa rota — já do lado do servidor, onde os externos são
respeitados — que regista os `node-cron`. Continua a ser um processo único.
O ciclo de 5 em 5 minutos também gera os dias da última semana que faltem
(idempotente): se o servidor estava suspenso às 00h05, o dia aparece na mesma.

## A página

Um único ecrã e um único quadro, sem autenticação.

**Duas linhas de filtro:**

- **Periodicidade** — Todas, Todos os dias, 2ª a 6ª, um por cada dia da semana,
  Dia do mês, Sem agenda. Gerados a partir da configuração: quando as
  newsletters mudarem, os filtros acompanham.
- **Visão** — Diária, Semanal, Mensal.

| Visão | Mostra | Navega |
|---|---|---|
| Diária | Um dia, com o estado por extenso. As horas ficam atrás do `Mostrar horas` | dia a dia |
| Semanal | Uma semana, 2ª a 6ª | semana a semana |
| Mensal | Um mês | mês a mês |

Os botões `‹` e `›` andam para trás e para a frente na unidade da vista. O `›`
desliga-se quando se chega ao presente — não há registos no futuro — e aparece
um botão `Hoje` quando se está fora dele.

Nas vistas semanal e mensal, `Incluir fim de semana` acrescenta sábado e
domingo, preciso para as duas newsletters que saem ao fim de semana.

A vista e o dia que a ancora vivem no URL (`/?vista=semanal&ate=2026-08-24`),
para os botões funcionarem e para a exportação sair exatamente do que se está
a ver.

Clicar numa linha ou numa célula mostra o campo `detalhe`. A **legenda dos
códigos está fixa no fundo**, para estar à mão em qualquer ponto do scroll.

## Descarregar para Excel

O botão **Descarregar Excel** dá um `.xlsx` do período e do filtro que estão à
vista. Três folhas:

| Folha | O que tem |
|---|---|
| Matriz | Newsletters em linhas, dias em colunas, o código na célula — a vista que a equipa reconhece |
| Registos | Uma linha por newsletter por dia, com horas, atraso, ocorrências e o `detalhe` por extenso. É a folha para filtrar e fazer tabelas dinâmicas |
| Resumo | Contagem de cada código por newsletter no período |

O ficheiro é escrito à mão em `src/lib/excel.ts`, sem dependências: um xlsx é
um zip com XML lá dentro, e o `node:zlib` faz as duas pontas. Evita mais um
módulo nativo para instalar num Windows sem compilador — o que já custou uma
vez neste projeto.

## Produção

```bash
npm run build
pm2 start ecosystem.config.cjs
```

Processo único. Sem Docker, sem Postgres, sem proxy.

## O que está fora desta versão

Importação do **histórico** do Excel (a grelha dia-a-dia das folhas "Todos os
Dias", "2ª a 6ª" e "Semanal"); células com o valor `c`; CRUD de newsletters pela
interface; autenticação; exportação CSV/XLSX; correções manuais e auditoria;
ecrã de emails não classificados; alertas.

As 62 newsletters **já estão** configuradas — o que a spec v3 punha fora de
âmbito era escrevê-las à mão, e isso resolveu-se com o importador.
