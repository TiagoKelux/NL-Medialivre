# Monitor de Newsletters — manual da equipa

**Endereço:** https://34-148-158-177.sslip.io
**Utilizador:** `medialivre` (a palavra-passe é entregue à parte)

## O que é

O monitor está inscrito nas newsletters da Medialivre com a caixa
`nlmedialivre@gmail.com`. De 5 em 5 minutos lê essa caixa, reconhece cada
newsletter que chegou e compara com o horário do Excel. O painel mostra, para
cada newsletter e cada dia, se saiu, se saiu tarde, se saiu repetida ou em
duplicado, ou se não saiu.

Regra de ouro: **o monitor só afirma o que consegue provar.** Quando não sabe,
diz que não sabe — com um símbolo próprio, nunca com um "Não Saiu".

## O painel

- **Topo:** a hora da última leitura da caixa e os avisos (ver "Avisos").
  Ao lado, a ligação para **Por classificar**.
- **Periodicidade:** filtra por Todos os dias, 2ª a 6ª, um dia da semana,
  Dia do mês ou Sem agenda.
- **Visão:** Diária (um dia, com o estado por extenso; `Mostrar horas` mostra
  hora prevista, recebida e atraso), Semanal ou Mensal (uma grelha com um
  número por dia). `‹` e `›` mudam de dia/semana/mês; `Hoje` volta ao
  presente; `Incluir fim de semana` mostra sábado e domingo.
- **Passar o rato** numa célula mostra um resumo da edição; **clicar** abre a
  newsletter tal como chegou, ou a explicação do estado quando não chegou
  nada. Cada estado tem uma explicação por extenso ("detalhe") — é lá que se
  vê a hora a que chegou, o atraso, ou porque é que não há prova.
- A **★** marca as newsletters pagas. Desde 05/11/2026 a caixa tem acesso
  premium (por um ano) e as pagas são vigiadas como as outras.
- A **legenda** está sempre no fundo do ecrã.

## Os estados

### Os seis códigos

| Símbolo | Cor | Estado | Quer dizer |
|---|---|---|---|
| **1** | verde | Saiu e Tem Conteúdo Atualizado | Chegou até à hora limite, com conteúdo diferente da edição anterior |
| **2** | amarelo | Saiu Atrasada | Chegou, mas depois da hora limite. O detalhe diz quanto tempo depois |
| **3** | roxo | Saiu Duplicada | O editor mandou dois envios diferentes da mesma edição |
| **4** | laranja | Saiu com Conteúdo Desatualizado | Chegou, mas igual à edição anterior (mesmo texto, ou exatamente os mesmos artigos) |
| **5** | vermelho | Não Saiu | Não chegou até à hora limite **e há prova** de que, se tivesse saído, teria chegado |
| **6** | cinzento | Desativada / Não agendada | Não era dia dela (ou feriado, numa de dias úteis), ou está desligada no Excel |

Quando uma edição tem mais do que um problema, mostra-se o mais grave
(5, depois 3, depois 4, depois 2).

Se o detalhe de um 1 disser "⚠ provavelmente repetida: X de Y artigos iguais",
a maior parte dos artigos é a da edição anterior, mas não todos: o monitor não
decide, fica à vossa avaliação.

### Quando o monitor não pode afirmar um código

| Símbolo | Aparência | Estado | Quer dizer |
|---|---|---|---|
| **…** | branco, contorno tracejado | A aguardar | Ainda não chegou a hora limite. Nada a fazer |
| **?** | amarelo, contorno tracejado | Por confirmar | A hora limite passou, mas a caixa ainda não foi lida depois disso (monitor parado ou leitura a falhar). Muda sozinho quando a leitura voltar |
| **∅** | cinzento, contorno vermelho tracejado | Não recebida – sem prova | Não chegou, mas não há prova de que não saiu. Pode ter saído e a caixa não a ter recebido. O detalhe diz porquê |
| **–** | preto | Não assinada no email | O monitor ainda não sabe reconhecer os emails desta newsletter (não tem remetente configurado). Nenhum estado dela quer dizer nada |
| **S** | verde, contorno tracejado | Saiu (sem termo de comparação) | Chegou, mas não há edição anterior para comparar — não se pode dizer se o conteúdo é novo |

## A hora limite e o "saiu tarde"

- **Hora limite = hora prevista no Excel + 30 minutos.** (Onde o Excel tem
  duas horas, "12h ou 18h", conta a mais tarde + 30 min.)
- Chegou até à hora limite → saiu (1, 3 ou 4).
- Não chegou até à hora limite → **5 Não Saiu** se houver prova; senão **∅**.
- Se o email chegar depois — uma hora, uma tarde, ou (nas semanais) uns dias
  depois — o registo **passa sozinho a 2 Saiu Atrasada**, mesmo que já
  estivesse "Não Saiu". Um email que chegou nunca fica "Não Saiu".
- Numa semanal, um envio num dia em que ela não costuma sair conta para a
  edição que faltou: a de quinta que chega a sábado é a de quinta, atrasada.
- Uma edição que chegue até 6 h **antes** da hora prevista conta como desse
  dia, dentro do prazo.

Por isso, um dia recente pode mudar: **∅** pode passar a **5** (chegou a
prova) ou a **2** (chegou o email); um **5** pode passar a **2** ou a **∅**.
Para relatórios fechados, exportar alguns dias depois.

## Porque existe o "sem prova"

Os editores deixam de mandar uma newsletter a quem não abre 6 envios
seguidos. A caixa do monitor não é uma pessoa: se o editor a cortar, as
newsletters deixam de chegar **sem terem deixado de sair**. Dizer "Não Saiu"
nesse caso seria falso.

Para dar **5 Não Saiu**, o monitor exige, entre outras coisas:

- que a caixa já tenha recebido esta newsletter antes (está inscrita);
- que outro email do mesmo editor tenha chegado nas 24 h a seguir (a caixa
  estava a receber deste editor);
- que o editor não tenha mandado, no último mês, um email de "reativação"
  ("Queremos garantir que continua connosco", "Sentimos a sua falta"…) — é o
  aviso de que vai cortar;
- que não estejam em falta 3 edições seguidas (2 nas semanais): um silêncio
  longo é mais provavelmente a caixa cortada do que a newsletter parada;
- que não haja na caixa um email por classificar que possa ser ela.

Se faltar alguma, fica **∅** e o detalhe diz qual. Muitas vezes um **∅** de
hoje passa a **5** amanhã, quando chega o email seguinte do mesmo editor.

Para não ser cortado, o monitor "abre" sozinho cada email que chega. Mesmo
assim, se uma lista for cortada, é preciso voltar a inscrever a caixa (ver
"Avisos").

## Avisos no topo

| Aviso | O que fazer |
|---|---|
| "Caixa lida às HH:MM (há N min) · lê de 5 em 5 minutos" | Normal |
| **"A leitura da caixa está a falhar desde as …"** | Os dias seguintes ficam "? Por confirmar" até voltar. Se durar mais de 15 min, contactar o suporte (normalmente é a palavra-passe da caixa) |
| **"Última leitura da caixa às …, há …"** | O monitor parou, ou a página está aberta há muito tempo: recarregar. Se continuar, contactar o suporte |
| **"A caixa ainda não foi lida"** | Monitor acabado de instalar; se continuar, contactar o suporte |
| **"A caixa monitorizada deixou de receber as newsletters diárias de: …"** | Um editor cortou a caixa (2 ou mais dias esperados sem nenhuma diária dessa marca). As newsletters não falharam: esses dias ficam ∅. É preciso **reinscrever** `nlmedialivre@gmail.com` nessas newsletters (em https://aminhaconta.xl.pt ou nos formulários de inscrição dos sites) e abrir os emails de reativação. Inscrever sempre com `nlmedialivre@gmail.com`, sem pontos — `nl.medialivre@` é a mesma caixa, mas o editor trata-a como outro assinante e passa a mandar tudo duas vezes |
| "N emails da última semana sem newsletter atribuída — classificar ›" | Ver "Por classificar" |

## Descarregar Excel

O botão **Descarregar Excel** descarrega exatamente o período e o filtro que
estão à vista. Três folhas:

- **Matriz** — newsletters nas linhas, dias nas colunas, o código (ou o
  símbolo …, ?, ∅, –, S) em cada célula;
- **Registos** — uma linha por newsletter e por dia, com hora prevista, hora
  limite, hora recebida, atraso, estado por extenso e o detalhe. É a folha
  para filtrar e fazer tabelas dinâmicas;
- **Resumo** — quantos dias de cada código (1 a 6) teve cada newsletter. Os
  símbolos (…, ?, ∅, –, S) não entram na contagem.

## Por classificar

A página **Por classificar** (ligação no topo do painel) mostra os emails da
última semana que chegaram à caixa mas não foram reconhecidos como nenhuma
newsletter — por exemplo, uma newsletter nova ou que mudou de remetente.

- **Atribuir:** se o email é uma edição, escolher a newsletter (muitas vezes
  vem sugerida) e carregar em Atribuir. A partir daí, os emails desse
  remetente com essa marca contam como edições dela, também para trás, e o
  painel atualiza logo. Só se podem atribuir emails que trazem a marca de
  publicidade da newsletter — é a prova de que é uma edição e não marketing.
- **Não é newsletter:** para promoções e marketing. Pode ignorar-se só aquele
  email ou todos com o mesmo assunto. Deixam de aparecer e deixam de impedir
  um "Não Saiu".
- **Desfazer:** tudo se desfaz na mesma página. Em "Últimas alterações" fica
  quem mudou o quê e quando.

A mesma página mostra, por newsletter ativa, se o monitor a reconhece e
quando chegou a última edição.

Mudar horários, dias ou acrescentar uma newsletter faz-se no **Excel** de
horários e pede uma atualização ao suporte (não se faz no painel).

## Contactos

**A transferir na entrega** — enquanto o suporte estiver com a Kelux:

- Suporte técnico e alertas automáticos: Kelux, `tb@kelux.ai`.
- Caixa monitorizada: `nlmedialivre@gmail.com`.

Ao reportar um problema, enviar: a newsletter, o dia e o texto do detalhe (ou
uma captura do painel).
