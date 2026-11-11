# Media Livre — Monitor de Newsletters

Lê a caixa de correio `nlmedialivre@gmail.com` de 5 em 5 minutos, identifica
a que newsletter pertence cada email, compara com o calendário de cada uma,
atribui um código de 1 a 6 e mostra tudo num painel protegido por
palavra-passe.

- **Painel:** https://34-148-158-177.sslip.io (utilizador `medialivre`)
- **Manual para a equipa:** [docs/MANUAL-CLIENTE.md](docs/MANUAL-CLIENTE.md)
- **Servidor, atualizações, cópias, avarias:** [docs/SERVIDOR.md](docs/SERVIDOR.md)
- **Análise dos duplicados:** [docs/ANALISE-DUPLICADOS.md](docs/ANALISE-DUPLICADOS.md)

## O que faz

- Lê a caixa por IMAP (Gmail: "Todo o correio", Spam e Lixo) de 5 em 5
  minutos; um email visto em duas pastas conta uma vez.
- Identifica cada email pelo conteúdo (o bloco de publicidade de cada
  newsletter), não só pelo remetente — o marketing do editor não passa por
  edição.
- Atribui um estado por newsletter e por dia: saiu, atrasada, duplicada,
  conteúdo repetido, não saiu, não agendada.
- Só diz "Não Saiu" com **prova de ausência**; sem ela diz que não sabe.
- Abre sozinho cada email novo (pixel de abertura), para os editores não
  cortarem o envio à caixa por inatividade.
- Avisa no painel quando a leitura falha ou pára, e quando um editor deixa de
  mandar as diárias à caixa.
- Calendário de cada dia congelado: mudar o Excel hoje não reescreve o
  passado (há um comando para o fazer de propósito).
- Feriados nacionais.
- Vistas diária, semanal e mensal; filtros por periodicidade; resumo e
  newsletter completa ao passar/clicar numa célula.
- Exportação para Excel (.xlsx) do que está à vista.
- Página **Por classificar**: atribuir emails a newsletters e ignorar
  marketing, sem mexer em código, com registo de quem mudou o quê.
- Cópia diária da base de dados, dentro e fora do servidor; alerta por email
  se o monitor parar (docs/SERVIDOR.md).

## O ciclo

```
1. lê a caixa de correio a cada 5 minutos (e abre os emails novos)
2. identifica a que newsletter pertence cada email
3. compara com o que era esperado e atribui um código de 1 a 6
4. fecha os registos cuja hora limite passou, se houver prova
5. mostra tudo numa página
```

Outros trabalhos, no mesmo processo (`src/app/api/arranque/route.ts`): às
00h05 gera as linhas do dia; às 03h30 faz a cópia da base de dados. No
arranque, tapa os dias em falta e recalcula os últimos 45 dias.

## Estados

| Código | Designação | Regra |
|---|---|---|
| 1 | Saiu e Tem Conteúdo Atualizado | Chegou até à hora limite, conteúdo diferente do da edição anterior, um só envio |
| 2 | Saiu Atrasada | Chegou depois da hora limite — minutos, horas ou (nas não diárias) dias depois |
| 3 | Saiu Duplicada | Dois envios distintos do editor ao mesmo endereço, na mesma edição (ver "Duplicados") |
| 4 | Saiu com Conteúdo Desatualizado | Hash do texto normalizado igual ao da edição anterior, ou exatamente os mesmos artigos (≥ 3) |
| 5 | Não Saiu | Nada recebido até à hora limite, **com prova de ausência** (ver abaixo) |
| 6 | Desativada / Não agendada | `ativa: false`, ou hoje não é dia esperado (as "dias úteis" não são esperadas nos feriados nacionais) |

Precedência, do mais grave para o menos: **6 → 5 → 3 → 4 → 2 → 1**. O 6 avalia-se
primeiro e faz curto-circuito. O `codigo_estado` tem um `CHECK (BETWEEN 1 AND 6)`
na base de dados: é impossível gravar outra coisa.

Para lá do código, o painel e o Excel mostram variantes quando o código não
pode ser afirmado (`src/lib/apresentacao.ts`, `ROTULO`): **A aguardar** (`…`),
**Por confirmar** (`?`), **Não recebida – sem prova** (`∅`), **Não assinada no
email** (`–`) e **Saiu (sem termo de comparação)** (`S`). O significado de cada
um está no [manual](docs/MANUAL-CLIENTE.md).

### Hora limite e "saiu tarde"

Regra do cliente (08/11/2026): **hora limite = hora prevista + 30 min**
(`TOLERANCIA_MIN`, em `src/lib/edicao.ts`). Onde o Excel tem duas horas
("12h ou 18h", "16h30 // 17h"), a prevista é a mais cedo e a tolerância
alarga-se até à mais tarde + 30 min.

- até à hora limite → saiu (1, 3 ou 4);
- nada até à hora limite → **5 Não Saiu**, se houver prova de ausência;
  senão "Não recebida – sem prova" ou "Por confirmar";
- um email que chegue depois → **2 Saiu Atrasada**, retroativamente: o
  registo que estava "Não Saiu" passa a 2, com o atraso no detalhe. Um email
  que chegou nunca é "Não Saiu".

A edição de um dia D é tudo o que chega entre **6 h antes e 18 h depois** da
hora prevista em D. A das 21:00 que chega às 00:30 do dia seguinte é a do dia
anterior, atrasada. Numa newsletter que não sai todos os dias (semanal,
"dias úteis" ao fim de semana), um email que caia num dia **sem edição
própria** conta para a última edição em falta, até 31 dias depois
(`edicaoAnteriorEmFalta`): a semanal de quinta que chega a sábado é a de
quinta, atrasada. Numa diária, o dia seguinte já tem edição própria.

De 29/09 a 15/10, o maior adiantamento real foi de 1 h 27 min.

O ciclo revê os "Não Saiu" dos últimos 14 dias (`reverNaoSaiu`): os que
recebem um email passam a 2; os que perdem a prova (por exemplo, faltaram
também as edições seguintes) voltam a "sem prova".

### Feriados

`src/lib/feriados.ts`: os 13 feriados nacionais obrigatórios, incluindo os
móveis (Sexta-feira Santa, Páscoa e Corpo de Deus). O Carnaval e os feriados
municipais não contam. Num feriado, uma newsletter de "dias úteis":

- se não chegar nada → **6**, "Feriado nacional (…): não prevista";
- se chegar → conta como qualquer outro dia. A 05/10/2026 saíram a Abertura,
  a Opinião, a Tecnologia e o Fecho do Negócios, e a 5 Coisas não.

### Calendário de cada dia

Cada registo grava o calendário da newsletter nesse dia (`registos.calendario`:
periodicidade, dias, hora, tolerância, ativa). Quando o dia passa, esse
calendário fica congelado — também para a prova de ausência. Mudar o Excel
hoje muda hoje e os dias seguintes, nunca o que já passou. As regras de
identificação e de classificação continuam a aplicar-se a todo o histórico.

Para corrigir o passado de propósito (o Excel estava errado), ver
"Corrigir o passado" abaixo.

### Edição ou não: a campanha do Echobox

Todas as edições trazem um link "ver no browser" do Echobox com um token
(JWT). O token diz a **campanha**, o **envio** e o **destinatário**
(`lerEnvio`, em `src/lib/marcas.ts`). Medido de 29/09 a 15/10:

- 119 edições de 119 trazem o token;
- há uma campanha por newsletter (25 newsletters, 25 campanhas), e nenhuma
  campanha é partilhada;
- o marketing (boas-vindas, reconquista, "Indica") não traz token, ou vem de
  campanhas próprias.

As campanhas de cada newsletter são **aprendidas** das edições que a
`marcaCorpo` atribuiu (`lerCampanhas`), nunca escritas à mão. Um email por
atribuir só trava o "Não Saiu" de uma newsletter (regra 3 da prova) se:

- vier da campanha dela;
- ou tiver cara de edição (bloco de publicidade ou `marcaCorpo`) — rede de
  segurança para templates e campanhas novas;
- ou, enquanto ela não tem campanha conhecida, se a heurística do remetente
  o achar plausível.

Vir da campanha de outra newsletter, de uma campanha nova sem cara de edição,
ou sem token quando as edições dela o trazem, deixa de travar
(`campanhaDecide`, em `prova.ts`).

Os emails marcados no painel como **"não é newsletter"** também deixam de
travar o "Não Saiu".

### Duplicados

A análise completa está em [docs/ANALISE-DUPLICADOS.md](docs/ANALISE-DUPLICADOS.md).
Pelo token, cada email diz de que envio do editor vem e para que endereço foi:

- o **mesmo envio** a chegar duas vezes (reentrega) conta como um;
- a **caixa inscrita com dois endereços** (o Gmail ignora os pontos:
  `nl.medialivre@` e `nlmedialivre@` são a mesma caixa, mas para o editor são
  dois assinantes) conta só o primeiro endereço, e o detalhe avisa;
- **dois envios distintos ao mesmo endereço** → **3 Duplicada**, "ids de envio
  diferentes";
- sem token, cada Message-ID diferente continua a ser um envio.

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

Um 1 sem edição anterior comparável mostra-se como **Saiu (sem termo de
comparação)** (ressalva `sem-comparacao`): chegou, mas "conteúdo atualizado"
não está provado.

### Prova de ausência

Um registo só fecha como **5 — Não Saiu** quando há prova de que a newsletter
não chegou: "a caixa foi lida e não veio nada" não chega (os editores cortam o
envio a caixas inativas). Sem prova fica em aberto (`fechado = 0`, ressalva
`sem-prova`) e o painel e o Excel mostram **Não recebida – sem prova**, com o
detalhe a dizer porquê.

A prova de leitura (`fecharVencidos`, em `src/lib/registos.ts`): uma leitura
bem-sucedida da caixa pelo menos 10 min depois da hora limite
(`MARGEM_FECHO_MIN`), com a cobertura contínua das leituras a abranger toda
a janela da edição. Enquanto não houver, o registo mostra **Por confirmar**.

A prova de ausência (`motivosSemProva`, em `src/lib/prova.ts`) exige, para
todas as newsletters — gratuitas e pagas:

1. remetentes configurados;
2. pelo menos um email da newsletter recebido **antes** desse dia (prova de
   que a caixa está inscrita);
3. nenhum email por atribuir, na janela da edição, que possa ser dela — do
   mesmo remetente configurado, ou com a marca e o nome (ou o padrão do
   remetente) no nome ou no assunto. O mesmo domínio com outro endereço não
   conta, para o marketing de assinaturas não travar as gratuitas da marca;
4. um **canário**: outro email do mesmo remetente (endereço ou domínio)
   chegou nas 24 h depois do limite — que não seja marketing do editor
   (boas-vindas, promoções conhecidas, reconquista): a campanha de
   reconquista chega precisamente quando o editor corta as edições;
5. nenhum email de reconquista do mesmo domínio nos 30 dias anteriores, nem
   nas 24 h do canário. É reconhecido pela **estrutura**, não pela redação do
   assunto (`eNaoEdicaoDoEditor`, em `correspondencia.ts`): vem de um
   endereço de edições, não traz marca de edição (nem o bloco
   `/4196/…_LEADERBOARD`, nem a `marcaCorpo` de nenhuma newsletter desse
   endereço), foi feito no editor de campanhas (imagens em
   `assets.unlayer.com`) e tem menos de 2 000 caracteres de texto. As
   boas-vindas ("Bem-vindo(a)…") têm o mesmo molde e não contam; os assuntos
   antigos ("Queremos garantir que continua connosco", "Notámos que há algum
   tempo…", "Sentimos a sua falta") continuam a contar como rede extra;
6. menos de **3 edições seguidas em falta** (2 nas semanais e mensais),
   contando para trás **e para a frente**. O primeiro dia de um corte da
   caixa parece um "Não Saiu" isolado; quando faltam também as seguintes,
   toda a sequência passa a "Não recebida – sem prova".

O arranque reavalia os registos antes de ler a caixa, e com a leitura a falhar
nada fecha. Um email por atribuir que chegue depois de um "Não Saiu" fechado,
e possa ser dele (ponto 3), reabre-o. Um registo que deixe de ser 6
(newsletter reativada, calendário mudado) não herda o `fechado` do 6.

**Pagas:** desde 05/11/2026 a caixa tem acesso premium por um ano. As pagas
(`config/pagas.ts`) deixaram de ser grupo de controlo e seguem as mesmas
regras; a lista serve só para a estrela ★ no painel.

As ressalvas vivem na coluna `registos.ressalva`; o `codigo_estado` e o seu
CHECK não mudam.

### Caixa cortada e abertura automática

Os editores deixam de mandar uma lista a quem não abre **6 envios seguidos**.
A caixa é lida por IMAP, que nunca carrega imagens: para o editor, a caixa
nunca abria nada, e a 06/10 as diárias de CM, Record, Negócios e Máxima
deixaram de chegar (as da FLASH! a 15/10).

Desde então, a recolha pede o **pixel de abertura** do Amazon SES de cada
email novo (`src/lib/abertura.ts`) — o que um cliente de email faz ao mostrar
as imagens. Só esse pixel: nunca um link nem outras imagens. Uma falha nunca
trava a recolha. Desliga-se com `MARCAR_ABERTURA=0`.

Uma lista que já foi cortada não volta sozinha: é preciso reinscrever a caixa
(procedimento em [docs/SERVIDOR.md](docs/SERVIDOR.md#uma-newsletter-ou-uma-marca-inteira-deixou-de-chegar)).
Para o detetar, `src/lib/caixa.ts` mede, por domínio do editor (diárias
ativas com remetente), quantos dias esperados de uma diária, com o limite já
passado, ficaram sem **nenhuma** diária desse domínio. Com 2 ou mais, o
domínio entra em `caixaCortada`:

```json
"caixaCortada": [{ "dominio": "news.jornalrecord.pt", "desde": "2026-10-06",
                   "ultimaEdicao": "2026-10-05T10:05:48.000Z", "diasEsperadosSemEdicao": 10 }]
```

Aparece no painel (aviso no topo), no `/api/estado` (atrás da palavra-passe)
e no log (`CAIXA CORTADA …`, e `Caixa normalizada` quando esvazia), **sem
mexer no 200/503** do `/api/saude`, que depende só da leitura. Um domínio de
que nunca chegou nenhuma diária não conta.

### Saúde

- `/api/saude` — público (o alerta do Cloud Monitoring lê-o). Só traz
  `saudavel`, `ultimaLeitura`, `minutosDesdeLeitura` e `falha` (código
  genérico `"leitura_falhou"`, nunca o erro em bruto). **503 só ao fim de
  15 min sem uma leitura boa**: uma falha isolada do Gmail recupera no ciclo
  seguinte e não dispara o alerta.
- `/api/estado` — o mesmo 200/503 com o detalhe: a mensagem de erro, a caixa
  por editor e `caixaCortada`.

### Marcas guardadas à entrada

A identificação precisa de meia dúzia de coisas do corpo (as `marcaCorpo`
que traz, o bloco de publicidade, as imagens do editor de campanhas, o
tamanho do texto, o token do Echobox). São extraídas uma vez, à entrada, para
a coluna `emails.marcas` (`src/lib/marcas.ts`), e a reclassificação de 5 em 5
minutos usa-as em vez de reler o `corpo_html` de todos os emails. As marcas
levam a impressão digital das `marcaCorpo` configuradas: mudar uma marca em
`config/newsletters.ts` faz com que sejam extraídas outra vez, uma vez.

## Arrancar (desenvolvimento)

```bash
npm install
cp .env.example .env      # preencher GMAIL_USER e GMAIL_APP_PASSWORD
npm run migrar            # cria a base de dados e as linhas dos últimos 30 dias
npm run dev               # http://localhost:3000
```

| Variável (`.env`) | Para quê |
|---|---|
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | A caixa por IMAP. A palavra-passe de app cria-se em https://myaccount.google.com/apppasswords e exige a verificação em dois passos ligada na conta |
| `DATABASE_PATH` | Por omissão `./data/monitor.db` |
| `MONITOR_INICIO` | Primeiro dia monitorizado (AAAA-MM-DD); antes dele não há registos |
| `MARCAR_ABERTURA` | `0` desliga a abertura automática dos emails |
| `HEALTHCHECK_URL` | Opcional (healthchecks.io). Não é usado no servidor atual |
| `CONTROLO_REMETENTES` | Endereços (separados por vírgulas) de quem manda o Excel de controlo por email; o anexo é importado sozinho, como em /controlo. Vazio = desligado |
| `GRAPH_CLIENT_ID`, `GRAPH_TENANT_ID` | Só para o caminho antigo do Microsoft Graph (abaixo) |

Sem caixa configurada a aplicação arranca na mesma: gera os registos e mostra
a página, mas não lê nada (o painel avisa "A caixa ainda não foi lida").

Parar o `npm run dev` antes de um `npm run build`: os dois escrevem em
`.next/` e o build fica com ficheiros em falta (todas as rotas `/api`
devolvem 500).

### Microsoft Graph (caminho antigo, opcional)

O primeiro protótipo lia uma caixa Microsoft 365 pelo Graph
(`src/lib/graph/`). Continua a funcionar, mas só é usado se `GMAIL_USER` e
`GMAIL_APP_PASSWORD` estiverem vazios. Precisa de uma app no Azure (Entra ID)
com a permissão **delegada** `Mail.Read` e **Allow public client flows**
ativo, de `GRAPH_CLIENT_ID`/`GRAPH_TENANT_ID` no `.env` e de `npm run auth`
uma vez (device code).

## As newsletters

`config/newsletters.ts` é **gerado** a partir da folha "Horário" do Excel. São
62 newsletters, 48 ativas. Não editar periodicidades nem horas à mão.

O importador desliga (`ativa: false`) tudo o que não consiga agendar com
segurança — estado que não seja "Ativa", periodicidade que não reconheça, ou
hora em falta — e deixa um comentário por cima da entrada a dizer porquê. É
preferível uma linha a cinzento do que inventar um horário que o Excel não diz.

### Acrescentar ou mudar uma newsletter

1. **Excel** — mudar a folha "Horário" (nome, periodicidade, dias, hora,
   estado).
2. **Importar**, no PC, na pasta do projeto:

   ```bash
   npm run importar -- "C:/caminho/Newsletters Horários.xlsx"
   ```

   Lê o `.xlsx` diretamente (sem dependências). Preserva `remetentes`,
   `padraoRemetente`, `padraoAssunto` e `marcaCorpo` de cada newsletter, pelo
   `id`. Se um `id` mudar (o nome mudou no Excel), lista as regras que se
   perderiam, com ATENÇÃO, e sai com erro: copiam-se à mão para a entrada nova
   (o ficheiro anterior está no git).
3. **Reconhecimento** — numa newsletter nova, preencher em
   `config/newsletters.ts` os `remetentes` e a `marcaCorpo` (ver abaixo). Em
   alternativa, sem código: esperar que chegue uma edição e atribuí-la na
   página **Por classificar**.
4. **Verificar** contra os emails já guardados, só em leitura:
   `npm run verificar [caminho/para/monitor.db]` — quantos emails cabem a cada
   newsletter, os sem dono e os que serviriam a mais do que uma regra (tem de
   ser zero). `npm test` tem de passar.
5. **Commit e instalar** no servidor ([docs/SERVIDOR.md](docs/SERVIDOR.md#atualizar-o-código)).
   No arranque, os emails já guardados são reclassificados e os últimos 45
   dias recalculados — o histórico não se perde.

A mudança de calendário vale de hoje para a frente. Para a aplicar também ao
passado, ver "Corrigir o passado".

### Como se reconhece uma newsletter

| Campo | O que é |
|---|---|
| `remetentes` | Endereços aceites. Uma entrada que comece por `@` vale para todo o domínio (`@exemplo.pt`) |
| `marcaCorpo` | Texto que **só as edições** desta newsletter trazem no HTML. É o critério principal |
| `padraoRemetente` | Nome do remetente **por inteiro** ("Vidas Geral"), sem distinção de maiúsculas, nunca por pedaço |
| `padraoAssunto` | Pedaço fixo do assunto, sem distinção de maiúsculas |

O endereço tem de bater, e todos os outros campos preenchidos também.
Enquanto uma newsletter não tiver remetente, o monitor guarda os emails mas
não os atribui, e o painel mostra "Não assinada no email".

**Porque é que o corpo manda.** As newsletters de cada marca partilham o
endereço (`info@news.jornaldenegocios.pt`, `info@news.flash.pt`…), o assunto é
a manchete do dia, e as editoras mandam marketing — boas-vindas, "volte a
ler-nos", "notámos que não lê" — do **mesmo endereço e com o mesmo nome** de uma
newsletter verdadeira. A Máxima Geral e a Máxima Fim de Semana chegam ambas
como "Máxima". Endereço e nome não chegam.

O que prova a edição é o bloco de publicidade: toda a edição de CM, Record,
Negócios, FLASH! e Máxima traz
`…/gampad/ad?iu=/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, e
nenhum email de marketing o traz. A `marcaCorpo` dessas newsletters é
`/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD` (a marca conta:
`NEWSLETTER_BOMDIA` existe na CM e na FLASH!). Vidas e MUST não têm o bloco: a
marca é o logótipo do cabeçalho, e exige-se também o nome do remetente.
Algumas pagas e a Primeira Página / Weekend do Negócios reconhecem-se pelo
remetente e pelo `utm_campaign`. Um email do remetente certo sem a marca fica
**por atribuir** — nunca passa por edição.

Para descobrir a marca de uma newsletter nova: procurar `MASTHEAD` no HTML de
uma edição (coluna `corpo_html` da tabela `emails`; com `/` ou `%2F`, o
matcher aceita as duas), ou ver a marca que a página Por classificar mostra.
`npm run listar` imprime remetente e assunto das últimas 24 h, sem gravar;
`npm run email -- ficheiro.eml` mete um `.eml` no sistema para testar.

A lista `ASSUNTOS_NAO_EDICAO` em `src/lib/correspondencia.ts` serve só para o
painel não mostrar o marketing conhecido em "Por classificar".

**Ficam de propósito sem regra:** os "… Indica" (`info@projetos.*`, comércio
afiliado, fora de âmbito).

### Pelo painel, sem código: "Por classificar" (`/classificar`)

O topo do painel liga para `/classificar`, onde a equipa trata sozinha os emails
que não contaram para nenhuma newsletter:

1. **Atribuir** — o email mostra a marca de publicidade que traz.
   Escolhe-se a newsletter (vem sugerida quando a marca o permite) e grava-se
   uma regra "endereço do remetente + marca" na tabela `regras_newsletter`.
   Emails sem marca não se podem atribuir (não há prova de que são edição).
2. **Não é newsletter** — ignora o assunto (normalizado) ou só aquela
   mensagem (tabela `exclusoes`). Tira o email da lista e deixa de travar o
   "Não Saiu".
3. Tudo se pode desfazer na mesma página, e cada alteração fica em
   `alteracoes` (quando, o utilizador da palavra-passe do painel, o quê).

As regras do painel **somam-se** ao `config/newsletters.ts`
(`src/lib/regras-fusao.ts`): nunca lhe tiram nada, e a aplicação nunca
escreve no `config/*.ts`. Uma regra é recusada se algum email guardado
passasse a servir a duas newsletters, se a marca já identificar outra
newsletter, ou se o email não trouxer a marca escolhida. Depois de gravar, os
emails são reclassificados e os registos da newsletter (45 dias)
reavaliados — o painel muda logo.

A mesma página mostra, por newsletter ativa, se é reconhecida (ficheiro,
painel ou ambos) e quando chegou a última edição.

## Corrigir o passado

O calendário de cada dia congela quando o dia passa. Se o Excel estava errado
(uma newsletter que afinal sai à quarta, não à terça), depois de corrigir o
Excel, importar e instalar:

```bash
npm run recalendarizar -- negocios-lex 2026-09-01 2026-10-15
npm run recalendarizar -- todas 2026-09-01 2026-10-15
```

Aplica o calendário atual aos dias indicados, reavalia-os, diz quantos mudaram
de código e deixa rasto em `alteracoes`. No servidor corre-se lá
([docs/SERVIDOR.md](docs/SERVIDOR.md)), como utilizador `monitor`.

## A página

Um painel protegido por palavra-passe (HTTP Basic, no Caddy à frente do
monitor — ver docs/SERVIDOR.md). O processo só ouve em `127.0.0.1`.

**Duas linhas de filtro:**

- **Periodicidade** — Todas, Todos os dias, 2ª a 6ª, um por cada dia da semana,
  Dia do mês, Sem agenda. Gerados a partir da configuração.
- **Visão** — Diária, Semanal, Mensal.

| Visão | Mostra | Navega |
|---|---|---|
| Diária | Um dia, com o estado por extenso. As horas ficam atrás do `Mostrar horas` | dia a dia |
| Semanal | Uma semana, 2ª a 6ª | semana a semana |
| Mensal | Um mês | mês a mês |

`‹` e `›` andam na unidade da vista; `›` desliga-se no presente e aparece
`Hoje` quando se está fora dele. `Incluir fim de semana` acrescenta sábado e
domingo. A vista e o dia vivem no URL (`/?vista=semanal&ate=2026-08-24`).

Passar o rato numa célula com conteúdo mostra um resumo da edição; clicar
abre a newsletter inteira (ou o `detalhe`, quando não chegou nada). A
**legenda está fixa no fundo**. As pagas têm uma ★.

No topo: o estado da leitura da caixa, o aviso de caixa cortada e a ligação
para "Por classificar" (com o número de emails da última semana sem
newsletter).

## Descarregar para Excel

O botão **Descarregar Excel** dá um `.xlsx` do período e do filtro que estão à
vista. Três folhas:

| Folha | O que tem |
|---|---|
| Matriz | Newsletters em linhas, dias em colunas, o código (ou o símbolo da variante) na célula |
| Registos | Uma linha por newsletter por dia, com horas, atraso, código, estado por extenso, ocorrências e o `detalhe`. É a folha para filtrar e fazer tabelas dinâmicas |
| Resumo | Contagem de cada código por newsletter no período (as variantes não contam) |

O ficheiro é escrito à mão em `src/lib/excel.ts`, sem dependências: um xlsx é
um zip com XML lá dentro, e o `node:zlib` faz as duas pontas.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Produção (no servidor, pelo pm2: `ecosystem.config.cjs`, porta 3001) |
| `npm test` | Testes (`test/*.test.ts`); correm antes de cada instalação |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrar` | Cria a base de dados e tapa buracos nos últimos 30 dias |
| `npm run recolher` | Corre um ciclo de recolha à mão |
| `npm run listar` | Lista os emails das últimas 24 h na consola, sem gravar |
| `npm run email -- <ficheiro.eml>` | Mete um `.eml` no sistema, pelo mesmo caminho da recolha |
| `npm run importar -- <xlsx>` | Regera `config/newsletters.ts` a partir do Excel (preserva as regras de reconhecimento) |
| `npm run verificar [db]` | Corre a correspondência sobre os emails guardados, só em leitura |
| `npm run recalendarizar -- <id\|todas> <de> <ate>` | Aplica o calendário atual a dias passados |
| `npm run auth` | Só Graph: autenticação por device code (uma vez) |

## Estrutura

```
config/newsletters.ts     as 62 newsletters — GERADO, não editar à mão (exceto as regras de reconhecimento)
config/pagas.ts           as pagas (só para a ★)
src/lib/
  tipos.ts                códigos, designações, cores, tipos das tabelas
  apresentacao.ts         variantes mostradas (A aguardar, Por confirmar, sem prova…), partilhado painel/Excel
  tempo.ts                fuso Europe/Lisbon (fixo, nunca o TZ do servidor), dias locais
  feriados.ts             feriados nacionais
  calendario.ts           calendário congelado de cada dia
  edicao.ts               janela da edição, hora limite (+30 min), edição tardia
  esquema.ts / db.ts      SQL das tabelas e ligação SQLite (WAL)
  conteudo.ts             normalização do corpo, hash e artigos
  correspondencia.ts      email → newsletter; marketing do editor pela estrutura
  marcas.ts               marcas do corpo e token do Echobox, extraídos à entrada
  regras.ts, regras-fusao.ts  regras do painel ("Por classificar") e fusão com a config
  classificacao.ts        o motor de estados, função pura
  prova.ts                prova de ausência (quando "nada chegou" é "Não Saiu")
  registos.ts             gerar o dia, reavaliar, fechar, rever "Não Saiu", ler para a página
  recolha.ts              gravar emails com deduplicação
  abertura.ts             abrir os emails novos (pixel do SES)
  caixa.ts                caixa cortada pelo editor
  leitura.ts              estado e cobertura das leituras da caixa
  saude.ts                o que o /api/saude e o /api/estado devolvem
  vigia.ts                linha CAIXA CORTADA no log; HEALTHCHECK_URL opcional
  copias.ts               cópia diária da base de dados
  ciclo.ts                o ciclo de 5 em 5 minutos
  excel.ts                escrita do .xlsx
  seguranca.ts            CSP, limpeza do HTML dos emails, recusa de pedidos de outra origem
  gmail/                  leitura da caixa por IMAP (caminho em uso)
  graph/                  leitura pelo Microsoft Graph (caminho antigo)
src/app/
  page.tsx, classificar/  o painel e a página "Por classificar"
  api/arranque            onde os jobs node-cron são registados
  api/saude, api/estado   saúde (pública) e detalhe
  api/exportar            o .xlsx
  api/classificar         atribuir / ignorar / desfazer
  api/conteudo, api/email, api/preview  a newsletter guardada e o resumo
  api/ciclo, api/gerar-dia  disparos manuais (só de dentro da máquina)
src/middleware.ts         recusa POST/PUT/… vindos de outra origem (CSRF)
src/components/           Painel.tsx e Classificar.tsx
src/instrumentation.ts    arranque — sem imports, ver nota abaixo
scripts/                  importar-horario, recalendarizar, verificar-correspondencia, calibrar-artigos…
scripts/servidor/         instalar.sh e instalar-gcp.sh
```

### Nota sobre o arranque

Os jobs correm dentro do processo do Next, mas **não** são registados no
`instrumentation.ts`. O Next compila esse ficheiro num bundle próprio ao qual o
`serverExternalPackages` não se aplica, e qualquer dependência que toque em
módulos nativos (`better-sqlite3`) ou em `require("crypto")` à moda antiga
faz falhar o servidor inteiro.

Por isso o `instrumentation.ts` não tem imports nenhuns: faz um `POST` a
`/api/arranque`, e é essa rota que regista os `node-cron`. Continua a ser um
processo único. O ciclo de 5 em 5 minutos também gera os dias da última semana
que faltem (idempotente). O ciclo não usa fuso (com `Europe/Lisbon`, o
node-cron saltou a hora repetida da mudança da hora); os jobs das 00h05 e das
03h30 usam.

## Produção

No Google Cloud, com pm2, Caddy (HTTPS e palavra-passe), cópias diárias e
alerta: tudo em [docs/SERVIDOR.md](docs/SERVIDOR.md).

## O que ainda não faz

- Importar o **histórico** do Excel (a grelha dia-a-dia das folhas "Todos os
  Dias", "2ª a 6ª" e "Semanal"); células com o valor `c`.
- Criar ou editar newsletters (calendário) pela interface — faz-se no Excel e
  com `npm run importar`.
- Exportação CSV (há .xlsx).
- Contas individuais no painel: há uma palavra-passe partilhada.
- Alertas por email de "caixa cortada" ou de newsletters em falta — aparecem
  no painel e no log; o alerta por email é só para o monitor parado.
- Reinscrever a caixa sozinho quando um editor a corta.
