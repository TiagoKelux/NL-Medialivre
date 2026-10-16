# Análise: saiu duplicada ou não?

16/10/2026. Dados: a caixa nlmedialivre@gmail.com de 29/09 a 15/10 (cópia local
da base, 194 emails, 119 edições de 25 newsletters).

## A pergunta

A Media Livre já identificou envios em duplicado. Para o monitor dizer
"Duplicada" com prova, é preciso distinguir quatro situações que, na caixa,
parecem iguais (dois emails da mesma newsletter no mesmo dia):

| Situação | O leitor recebeu | Deve ser |
|---|---|---|
| A. O editor mandou a edição duas vezes | 2 emails | **3 Duplicada** |
| B. O mesmo envio entregue duas vezes (reentrega do servidor) | 1 | não é duplicada |
| C. A nossa caixa está inscrita com dois endereços (`nl.medialivre` e `nlmedialivre` são a mesma caixa no Gmail) | 1 | não é duplicada — é um problema da caixa de teste |
| D. Um email de marketing do editor tomado por edição | 1 | não é duplicada — é erro de identificação |

Até agora o monitor só tinha o Message-ID: Message-IDs diferentes davam "3".
Isso apanha A, mas também C e D.

## O que os emails dizem

Todas as edições (119 de 119) trazem um link "ver no browser" do Echobox
com um token. O conteúdo do token é legível:

```json
{
  "iss": "prod.email.service.echobox.com",
  "custom:key": "<campanha>/<envio>/<lote>/recipients.parquet.email_service",
  "email": "nlmedialivre@gmail.com",
  "iat": 1790928190
}
```

- **campanha**: uma por newsletter. Há 25 newsletters e 25 campanhas, e
  nenhuma é partilhada. O marketing vem sem token ou de campanhas próprias;
- **envio**: um por cada vez que o editor dispara a campanha;
- **email**: o endereço para onde foi aquele envio.

Daqui sai um critério para cada situação:

| Situação | Envio | Destino | Resultado |
|---|---|---|---|
| A | diferente | igual | **3 Duplicada**, "ids de envio diferentes" |
| B | igual | igual | conta como 1, "o mesmo envio chegou 2 vezes" |
| C | — | diferente | conta só o 1.º endereço, aviso "caixa inscrita mais de uma vez" |
| D | — | — | já não chega a ser ocorrência: a `marcaCorpo` e a campanha excluem o marketing |

## O que se viu nos dados

Com as regras antigas (o `main`, no PC até 15/10), o painel mostrava 3 "Duplicada":

| Dia | Newsletter | O que era | Agora |
|---|---|---|---|
| 02/10 | Máxima Geral | 09:03 e 09:33: **dois envios distintos do editor** (ids `c030e075…` e `285225d3…`, os dois para nlmedialivre@gmail.com). O de 09:03 tinha 6 de 7 artigos iguais aos da edição de 01/10, e o de 09:33 era a edição certa. Pelo meio, contavam também uma reconquista e a Máxima Fim de Semana | **3 Duplicada, com prova** |
| 05/10 | Máxima Geral | uma reconquista ("Notámos que há algum tempo…") às 09:01 e a edição às 09:03 | 1 — situação D |
| 15/10 | Negócios Opinião | duas reconquistas ("Volte a ler o Jornal de Negócios…"), sem edição | não chegou edição — situação D |

Em 17 dias houve **um duplicado verdadeiro** (situação A) e **nenhum** caso B
ou C. Os outros dois "Duplicada" eram marketing contado como edição, e isso
já tinha sido corrigido no ramo `fiabilidade-prova`.

O caso da Máxima é o tipo de erro que interessa à Media Livre: o editor
mandou primeiro a edição de ontem e, 30 minutos depois, a de hoje. O detalhe
do registo diz as duas coisas: "Duplicada" e "1.º envio: provavelmente
repetido".

## Limites

- Sem token (newsletter que deixe de usar o Echobox), volta-se ao Message-ID:
  dois diferentes contam como dois envios.
- O token não é validado criptograficamente. Só se compara entre emails da
  própria caixa, por isso não há a quem interesse forjá-lo.
- Dois emails com o **mesmo** Message-ID continuam a contar como um, e a
  leitura IMAP nem descarrega o segundo. Continua em aberto
  (`test/revisao.test.ts`).
- A amostra é pequena: 17 dias, e a partir de 06/10 os editores cortaram as
  diárias a esta caixa por inatividade. Convém repetir a contagem com mais
  dados, com `node scripts/calibrar-artigos.ts` e uma contagem de
  `registos.codigo_estado = 3`.

## Testes

`test/decisoes.test.ts`, secção 4: um teste para cada situação (A, B, C e o
caso sem token), mais um de ponta a ponta com dois emails do mesmo envio
gravados na base.
