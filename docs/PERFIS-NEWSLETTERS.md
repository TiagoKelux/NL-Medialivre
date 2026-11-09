# Perfis das newsletters — mapa de características

> Gerado por `npm run mapa-perfis` a partir dos dados: 329 edições de 29/09/2026 a 08/11/2026, 2775 artigos distintos, 2681 com data de publicação (97%). Não editar à mão: correr outra vez sobre uma cópia da produção.

## Em linguagem simples

Cada edição que chega é comparada com **o histórico da própria newsletter** — as
edições anteriores dos últimos 90 dias, como o monitor as viu. Cada newsletter tem o seu
normal (umas apontam para artigos de há uma hora, outras para artigos de ontem;
umas reaproveitam metade dos artigos, outras nenhum), por isso os limites não são
iguais para todas: são aprendidos com o que cada uma costuma fazer.

### O que se verifica

| Pergunta | Como se responde | Resultado |
|---|---|---|
| Chegou? | Um email da newsletter na caixa, na janela da edição | Sem email: **5 Não Saiu** só com prova; senão **∅** |
| Chegou a horas? | Hora de chegada contra a hora prevista + 30 min | Depois disso: **2 Saiu Atrasada** |
| Chegou duplicada? | Dois envios distintos do editor no mesmo dia | **3 Saiu Duplicada** |
| É igual a uma edição antiga? | O mesmo conteúdo (texto normalizado) ou exatamente os mesmos artigos (pelo menos 3) que **qualquer** edição anterior, não só a de ontem | **4** (prova) |
| Os artigos são velhos? | A data de publicação do artigo **mais recente** da edição, contra o normal desta newsletter | Muito mais velho do que o normal e nada publicado desde a edição anterior: **4** (prova). Só mais velho: aviso |
| A data no topo está certa? | Só nas newsletters que escrevem sempre a data do dia no topo | Data errada: **4** (prova) |
| Reaproveita mais do que o costume? Tem artigos a mais ou a menos? | Contra o costume desta newsletter | Só aviso |

### Prova ou só aviso

- **Prova** muda o estado para **4 Saiu com Conteúdo Desatualizado**: edição igual a uma
  antiga; artigo mais recente muito mais velho do que o normal **e** já publicado antes
  de a edição anterior sair (uma edição legítima traz sempre alguma coisa nova; uma
  reenviada não traz nada); data errada no topo numa newsletter que a escreve sempre.
- **Aviso** (⚠ no detalhe da edição) não muda o estado, fica à vossa avaliação: artigo
  mais recente mais velho do que em qualquer edição anterior; artigos já usados acima do
  costume; número de artigos fora do costume.

### Porque não depende do aspeto

O modelo, as cores e os blocos das newsletters mudam sem aviso. Nada disto olha para
eles: só para **os artigos para onde a edição aponta** (os endereços), **a data de
publicação que a página de cada artigo declara** e o texto normalizado. Um modelo novo
com os mesmos artigos de ontem continua a ser apanhado; um modelo novo com artigos de
hoje continua a ser uma edição normal.

### Limites conhecidos

- **Edição que só repete a de ontem, quando a de ontem nunca chegou à caixa:** não há
  com que a comparar. Se os artigos forem de ontem, ficam dentro do normal de quem aponta
  para artigos de ontem — só dá aviso, ou nada.
- **Menos de 5 edições de histórico:** ainda não há perfil; a idade dos artigos só dá aviso (acima de 30 dias). A comparação com edições antigas funciona desde a 2.ª edição.
- **Artigos sem data de publicação:** uma edição só se mede pela idade com pelo menos 3 artigos datados e 60% dos artigos com data. Abaixo disso, só contam as outras verificações.
- **Datas só com o dia:** flash.pt, jornaldenegocios.pt, maxima.pt, must.jornaldenegocios.pt declaram só o dia de publicação (00:00), sem hora.
  Aí a idade tem a precisão de um dia: uma newsletter que aponta para os artigos de
  ontem aparece com mais de um dia. E a regra "nada publicado desde a edição anterior" não ajuda
  nestas: o dia de ontem às 00:00 é sempre anterior à edição de ontem. A prova vem só
  do limite de idade (e da comparação com edições antigas).
- **Newsletters que deixam de chegar** (a lista cortou a caixa): o perfil fica parado na
  última edição recebida e volta a servir quando a caixa for reinscrita.

## Os indicadores e os limites

| Indicador | Medido como | Prova (código 4) | Aviso |
|---|---|---|---|
| Igual a edição antiga | Texto normalizado igual, ou o mesmo conjunto de artigos (≥ 3) | Sempre | — |
| Idade do artigo mais recente | Chegada da edição − publicação do artigo mais recente | Acima de máx(1 dia, 3 × p90 da newsletter) **e** publicado antes da edição anterior | Acima desse limite mas com algo novo; ou acima de máx(1 dia, 1,5 × máximo da newsletter); sem perfil, acima de 30 dias |
| Data no topo | A primeira data nos primeiros caracteres do texto | Errada, se a newsletter a escreve certa em ≥ 90% de ≥ 5 edições | — |
| Reaproveitamento | Fração dos artigos já usados em edições anteriores | — | ≥ 80% e acima do p90 da newsletter + 20 pontos |
| Número de artigos | Endereços de artigos distintos na edição | — | Menos de metade do mínimo, ou mais de 1,5 × o máximo |

Os perfis (p50, p90, máximo) contam só as edições anteriores, e só com 5 ou mais. O artigo mais recente usa-se porque é estável em cada newsletter; a idade **mediana** não serve (há newsletters que apontam, ao lado das notícias do dia, para artigos de contexto com semanas).

**Verificação sobre este histórico** (`npm run calibrar-perfis`): cada edição julgada só com as anteriores — 329 edições, 181 medidas pela idade contra um perfil, **0 provas** e 2 avisos.

## Resumo

| Newsletter | Calendário | Edições | Prevista | Real (mediana) | Artigos | Mais recente (p50) | Com data | Reuso p90 | Data no topo | Perfil |
|---|---|---|---|---|---|---|---|---|---|---|
| CM — Boa Tarde | diária | 6 | 19:00 | 17:34 (-86 min) | 14 | 5 h | 99% | 0% | não | completo |
| CM — Bom Dia | diária | 25 | 10:00 | 10:07 (+7 min) | 14 | 3 h | 98% | 0% | não | completo |
| CM — Exclusivos | diária | 6 | 06:00 | 06:06 (+6 min) | 15 | 5 h | 96% | 0% | não | completo |
| CM — O Melhor da Semana | semanal (sex) | 1 | 16:00 | 16:05 (+5 min) | — | — | 100% | — | não | insuficiente (1 de 5) |
| Flash — Bom Dia | diária | 25 | 10:00 | 10:06 (+6 min) | 8 | 1,4 d | 100% | 50% | sim | completo |
| Flash — Moda e Beleza | dias úteis | 17 | 15:00 | 15:07 (+7 min) | 3 | 1,6 d | 100% | 60% | não | completo |
| Flash — Mundo | diária | 27 | 08:00 | 08:06 (+6 min) | 6 | 1,3 d | 100% | 50% | sim | completo |
| Flash — The Mag | semanal (sex) | 6 | 13:00 | 13:05 (+5 min) | 8 | 1,5 d | 100% | 13% | não | completo |
| Flash — Weekend | semanal (qui) | 6 | 07:00 | 07:08 (+8 min) | 8 | 1,3 d | 100% | 13% | não | completo |
| Máxima — Fim de Semana | semanal (sex) | 6 | 12:00 | 12:02 (+2 min) | 6 | 12 h | 100% | 83% | não | completo |
| Máxima — Geral | dias úteis | 18 | 09:00 | 09:03 (+3 min) | 7 | 1,4 d | 100% | 86% | não | completo |
| Must — Must | semanal (qua) | 6 | 16:30 | 16:34 (+4 min) | 5 | — | 100% | 60% | não | parcial (sem idade) |
| Negócios — 5 Coisas | dias úteis | 18 | 08:00 | 08:05 (+5 min) | 10 | 8 h | 99% | 11% | não | completo |
| Negócios — A Economia das Coisas | semanal (sex) | 1 | 14:00 | 14:06 (+6 min) | — | — | 100% | — | não | insuficiente (1 de 5) |
| Negócios — Abertura | dias úteis | 6 | 10:30 | 10:34 (+4 min) | 14 | 10 h | 100% | 21% | não | completo |
| Negócios — Assinantes Diária | dias úteis | 2 | 09:00 | 09:04 (+4 min) | — | — | 100% | — | não | insuficiente (2 de 5) |
| Negócios — Cripto | semanal (qui) | 1 | 11:30 | 11:34 (+4 min) | — | — | 100% | — | não | insuficiente (1 de 5) |
| Negócios — Fecho | dias úteis | 21 | 18:30 | 18:34 (+4 min) | 14 | 18 h | 99% | 20% | não | completo |
| Negócios — Finanças | semanal (ter) | 5 | 11:00 | 11:04 (+4 min) | 16 | 10 h | 100% | 0% | não | completo |
| Negócios — IP | semanal (seg) | 4 | 14:00 | 14:05 (+5 min) | — | — | 96% | — | não | insuficiente (4 de 5) |
| Negócios — Lex | semanal (qui) | 6 | 17:00 | 17:04 (+4 min) | 10 | 16 h | 98% | 30% | não | completo |
| Negócios — Opinião | dias úteis | 6 | 12:00 | 12:06 (+6 min) | 12 | 11 h | 100% | 33% | não | completo |
| Negócios — Opinião Economistas | semanal (sex) | 1 | 11:30 | 11:34 (+4 min) | — | — | 100% | — | não | insuficiente (1 de 5) |
| Negócios — Primeira Página | dias úteis | 2 | 06:00 | 06:02 (+2 min) | — | — | 91% | — | não | insuficiente (2 de 5) |
| Negócios — Sua Semana | semanal (dom) | 5 | 20:00 | 20:04 (+4 min) | 14 | 20 h | 99% | 6% | não | completo |
| Negócios — Tecnologia | dias úteis | 19 | 15:00 | 15:05 (+5 min) | 10 | 15 h | 95% | 67% | não | completo |
| Negócios — Weekend | semanal (sáb) | 1 | 15:00 | 15:03 (+3 min) | — | — | 100% | — | não | insuficiente (1 de 5) |
| Record — Benfica | diária | 6 | 11:45 | 11:07 (-38 min) | 19 | 1 h | 100% | 21% | não | completo |
| Record — Geral | diária | 25 | 09:00 | 09:04 (+4 min) | 22 | 1 h | 97% | 9% | não | completo |
| Record — O Melhor da Semana | semanal (sex) | 1 | 10:00 | 10:03 (+3 min) | — | — | 91% | — | não | insuficiente (1 de 5) |
| Record — Porto | diária | 6 | 11:00 | 11:06 (+6 min) | 19 | 1 h | 100% | 28% | não | completo |
| Record — Premium | diária | 28 | 07:00 | 07:05 (+5 min) | 19 | 1 h | 91% | 11% | não | completo |
| Record — Premium Plus | diária | 4 | 09:30 | 09:34 (+4 min) | — | — | 76% | — | não | insuficiente (4 de 5) |
| Record — Sporting | diária | 6 | 11:00 | 11:05 (+5 min) | 19 | 1 h | 100% | 26% | não | completo |
| Vidas — Geral | diária | 6 | 10:00 | 11:02 (+62 min) | 7 | 11 h | 100% | 0% | não | completo |

## Ficha de cada newsletter

### CM — Boa Tarde

`cm-boa-tarde` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 29/09/2026 a 04/10/2026 — **não chega desde 04/10** |
| Calendário configurado | diária |
| Dias em que chegou | ter 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 19:00 |
| Hora real | mediana 17:34 (-86 min), p90 19:30 (+30 min) |
| Artigos por edição | mediana 14, 14 a 15 |
| Artigo mais recente, idade | 5 h (p90 5 h, máx. 5 h) |
| Artigos com data de publicação | 99% (85 de 86); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | cmjornal.pt 99%, historiasdequemdasorte.cmjornal.pt 1% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 7 ou mais de 23 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### CM — Bom Dia

`cm-bom-dia` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 25, de 30/09/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | seg 3, ter 2, qua 4, qui 4, sex 4, sáb 4, dom 4 |
| Hora prevista | 10:00 |
| Hora real | mediana 10:07 (+7 min), p90 10:10 (+10 min) |
| Artigos por edição | mediana 14, 13 a 15 |
| Artigo mais recente, idade | 3 h (p90 9 h, máx. 9 h) |
| Artigos com data de publicação | 98% (352 de 358); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 7% |
| Escreve a data no topo | não |
| Aponta para | cmjornal.pt 99%, historiasdequemdasorte.cmjornal.pt 1% |

Como se julga a próxima edição:

- Igual a uma das 25 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,1 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 1,1 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 6 ou mais de 23 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### CM — Exclusivos

`cm-exclusivos` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 05/10/2026 — **não chega desde 05/10** |
| Calendário configurado | diária |
| Dias em que chegou | seg 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 06:00 |
| Hora real | mediana 06:06 (+6 min), p90 06:07 (+7 min) |
| Artigos por edição | mediana 15, 9 a 17 |
| Artigo mais recente, idade | 5 h (p90 5 h, máx. 5 h) |
| Artigos com data de publicação | 96% (80 de 83); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | cmjornal.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 26 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### CM — O Melhor da Semana

`cm-o-melhor-da-semana` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 06/11/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 1 |
| Hora prevista | 16:00 |
| Hora real | mediana 16:05 (+5 min), p90 16:05 (+5 min) |
| Artigos por edição | mediana 10, 10 a 10 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (10 de 10); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | cmjornal.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Flash — Bom Dia

`flash-bom-dia` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 25, de 30/09/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | seg 3, ter 2, qua 4, qui 4, sex 4, sáb 4, dom 4 |
| Hora prevista | 10:00 |
| Hora real | mediana 10:06 (+6 min), p90 10:08 (+8 min) |
| Artigos por edição | mediana 8, 8 a 8 |
| Artigo mais recente, idade | 1,4 d (p90 1,4 d, máx. 1,4 d) |
| Artigos com data de publicação | 100% (161 de 161); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 25%, p90 50%, máx. 63% |
| Escreve a data no topo | sim, sempre (certa em 25 de 25) |
| Aponta para | flash.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 25 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,3 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,1 d (e até 4,3 d) → aviso.
- Data no topo diferente do dia da edição → **prova**.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 12 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Flash — Moda e Beleza

`flash-moda-e-beleza` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 17, de 30/09/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 3, ter 4, qua 5, qui 2, sex 3 |
| Hora prevista | 15:00 |
| Hora real | mediana 15:07 (+7 min), p90 15:08 (+8 min) |
| Artigos por edição | mediana 3, 2 a 5 |
| Artigo mais recente, idade | 1,6 d (p90 1,6 d, máx. 1,6 d) |
| Artigos com data de publicação | 100% (44 de 44); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 20%, p90 60%, máx. 80% |
| Escreve a data no topo | não é hábito (certa em 5 de 17) |
| Aponta para | flash.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 17 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,9 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,4 d (e até 4,9 d) → aviso.
- Mais de 80% dos artigos já usados antes → aviso.
- Menos de 1 ou mais de 8 artigos → aviso.

No histórico: 14/10 80% dos artigos já tinham saído em edições anteriores (o costume é até 33%).

### Flash — Mundo

`flash-mundo` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 27, de 30/09/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | seg 4, ter 3, qua 4, qui 4, sex 4, sáb 4, dom 4 |
| Hora prevista | 08:00 |
| Hora real | mediana 08:06 (+6 min), p90 08:07 (+7 min) |
| Artigos por edição | mediana 6, 5 a 6 |
| Artigo mais recente, idade | 1,3 d (p90 1,3 d, máx. 1,3 d) |
| Artigos com data de publicação | 100% (122 de 122); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 17%, p90 50%, máx. 83% |
| Escreve a data no topo | sim, sempre (certa em 25 de 27) |
| Aponta para | flash.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 27 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,0 d (e até 4,0 d) → aviso.
- Data no topo diferente do dia da edição → **prova**.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 2 ou mais de 9 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Flash — The Mag

`flash-the-mag` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 02/10/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 6 |
| Hora prevista | 13:00 |
| Hora real | mediana 13:05 (+5 min), p90 13:08 (+8 min) |
| Edições com mais de um email | 4 |
| Artigos por edição | mediana 8, 8 a 8 |
| Artigo mais recente, idade | 1,5 d (p90 1,5 d, máx. 1,5 d) |
| Artigos com data de publicação | 100% (47 de 47); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 13%, máx. 13% |
| Escreve a data no topo | não |
| Aponta para | flash.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,6 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,3 d (e até 4,6 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 12 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Flash — Weekend

`flash-weekend` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 01/10/2026 a 05/11/2026 |
| Calendário configurado | semanal (qui) |
| Dias em que chegou | qui 6 |
| Hora prevista | 07:00 |
| Hora real | mediana 07:08 (+8 min), p90 07:08 (+8 min) |
| Artigos por edição | mediana 8, 8 a 8 |
| Artigo mais recente, idade | 1,3 d (p90 1,3 d, máx. 1,3 d) |
| Artigos com data de publicação | 100% (47 de 47); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 13%, máx. 13% |
| Escreve a data no topo | não |
| Aponta para | flash.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **3,9 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,9 d (e até 3,9 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 12 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Máxima — Fim de Semana

`maxima-fim-de-semana` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 02/10/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 6 |
| Hora prevista | 12:00 |
| Hora real | mediana 12:02 (+2 min), p90 12:05 (+5 min) |
| Artigos por edição | mediana 6, 6 a 6 |
| Artigo mais recente, idade | 12 h (p90 1,5 d, máx. 1,5 d) |
| Artigos com data de publicação | 100% (28 de 28); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 17%, p90 83%, máx. 83% |
| Escreve a data no topo | não |
| Aponta para | maxima.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,5 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,3 d (e até 4,5 d) → aviso.
- Reaproveitamento: nunca dá aviso (o costume já chega a 83%).
- Menos de 3 ou mais de 9 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Máxima — Geral

`maxima-geral` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 18, de 30/09/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 3, ter 3, qua 4, qui 4, sex 4 — **1 fora do calendário** (05/10) |
| Hora prevista | 09:00 |
| Hora real | mediana 09:03 (+3 min), p90 09:04 (+4 min) |
| Edições com mais de um email | 1 |
| Artigos por edição | mediana 7, 6 a 7 |
| Artigo mais recente, idade | 1,4 d (p90 1,4 d, máx. 3,3 d) |
| Artigos com data de publicação | 100% (67 de 67); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 43%, p90 86%, máx. 100% |
| Escreve a data no topo | não é hábito (certa em 0 de 18, outra data em 1) |
| Aponta para | maxima.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 18 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,1 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Reaproveitamento: nunca dá aviso (o costume já chega a 86%).
- Menos de 3 ou mais de 11 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Must — Must

`must-must` · perfil parcial (sem idade)

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 04/11/2026 |
| Calendário configurado | semanal (qua) |
| Dias em que chegou | qua 6 |
| Hora prevista | 16:30 |
| Hora real | mediana 16:34 (+4 min), p90 16:36 (+6 min) |
| Artigos por edição | mediana 5, 2 a 9 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (20 de 20); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 50%, p90 60%, máx. 60% |
| Escreve a data no topo | não |
| Aponta para | must.jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (poucas edições com artigos datados suficientes) — só aviso, acima de 30 dias.
- Mais de 80% dos artigos já usados antes → aviso.
- Menos de 1 ou mais de 14 artigos → aviso.

No histórico: 04/11 9 artigos (o costume é 2 a 5).

### Negócios — 5 Coisas

`negocios-5-coisas` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 18, de 30/09/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 2, ter 3, qua 4, qui 5, sex 4 |
| Hora prevista | 08:00 |
| Hora real | mediana 08:05 (+5 min), p90 08:06 (+6 min) |
| Artigos por edição | mediana 10, 5 a 15 |
| Artigo mais recente, idade | 8 h (p90 8 h, máx. 8 h) |
| Artigos com data de publicação | 99% (169 de 170); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 7%, p90 11%, máx. 21% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 18 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 1,0 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 2 ou mais de 23 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — A Economia das Coisas

`negocios-a-economia-das-coisas` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 06/11/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 1 |
| Hora prevista | 14:00 |
| Hora real | mediana 14:06 (+6 min), p90 14:06 (+6 min) |
| Artigos por edição | mediana 6, 6 a 6 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (6 de 6); precisão: só o dia em jornaldenegocios.pt |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 83%, theguardian.com 17% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Abertura

`negocios-abertura` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 07/10/2026 — **não chega desde 07/10** |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 1, ter 1, qua 2, qui 1, sex 1 — **1 fora do calendário** (05/10) |
| Hora prevista | 10:30 |
| Hora real | mediana 10:34 (+4 min), p90 10:36 (+6 min) |
| Artigos por edição | mediana 14, 14 a 14 |
| Artigo mais recente, idade | 10 h (p90 10 h, máx. 10 h) |
| Artigos com data de publicação | 100% (77 de 77); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 7%, p90 21%, máx. 21% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,2 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 1,2 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 7 ou mais de 21 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Assinantes Diária

`negocios-assinantes-diaria` · perfil insuficiente (2 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 2, de 05/11/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | qui 1, sex 1 |
| Hora prevista | 09:00 |
| Hora real | mediana 09:04 (+4 min), p90 09:04 (+4 min) |
| Artigos por edição | mediana 18, 16 a 18 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (33 de 33); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 6%, p90 6%, máx. 6% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 2 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Cripto

`negocios-cripto` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 05/11/2026 a 05/11/2026 |
| Calendário configurado | semanal (qui) |
| Dias em que chegou | qui 1 |
| Hora prevista | 11:30 |
| Hora real | mediana 11:34 (+4 min), p90 11:34 (+4 min) |
| Artigos por edição | mediana 8, 8 a 8 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (8 de 8); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não é hábito (certa em 1 de 1) |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Fecho

`negocios-fecho` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 21, de 29/09/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 4, ter 5, qua 4, qui 4, sex 4 — **1 fora do calendário** (05/10) |
| Hora prevista | 18:30 |
| Hora real | mediana 18:34 (+4 min), p90 18:36 (+6 min) |
| Artigos por edição | mediana 14, 14 a 15 |
| Artigo mais recente, idade | 18 h (p90 19 h, máx. 19 h) |
| Artigos com data de publicação | 99% (273 de 275); precisão: só o dia em jornaldenegocios.pt |
| Artigos já usados antes | mediana 7%, p90 20%, máx. 21% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 99%, marketingstars.nowcanal.pt 1% |

Como se julga a próxima edição:

- Igual a uma das 21 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **2,3 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,2 d (e até 2,3 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 7 ou mais de 23 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Finanças

`negocios-financas` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 5, de 06/10/2026 a 03/11/2026 |
| Calendário configurado | semanal (ter) |
| Dias em que chegou | ter 5 |
| Hora prevista | 11:00 |
| Hora real | mediana 11:04 (+4 min), p90 11:06 (+6 min) |
| Artigos por edição | mediana 16, 16 a 17 |
| Artigo mais recente, idade | 10 h (p90 11 h, máx. 11 h) |
| Artigos com data de publicação | 100% (82 de 82); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 5 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,4 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 1,4 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 8 ou mais de 26 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — IP

`negocios-ip` · perfil insuficiente (4 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 4, de 12/10/2026 a 02/11/2026 |
| Calendário configurado | semanal (seg) |
| Dias em que chegou | seg 4 |
| Hora prevista | 14:00 |
| Hora real | mediana 14:05 (+5 min), p90 14:06 (+6 min) |
| Artigos por edição | mediana 10, 9 a 10 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 96% (24 de 25); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 50%, p90 89%, máx. 89% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 4 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Lex

`negocios-lex` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 01/10/2026 a 05/11/2026 |
| Calendário configurado | semanal (qui) |
| Dias em que chegou | qui 6 |
| Hora prevista | 17:00 |
| Hora real | mediana 17:04 (+4 min), p90 17:05 (+5 min) |
| Artigos por edição | mediana 10, 9 a 10 |
| Artigo mais recente, idade | 16 h (p90 17 h, máx. 17 h) |
| Artigos com data de publicação | 98% (48 de 49); precisão: só o dia em jornaldenegocios.pt |
| Artigos já usados antes | mediana 20%, p90 30%, máx. 30% |
| Escreve a data no topo | não é hábito (certa em 0 de 6, outra data em 1) |
| Aponta para | jornaldenegocios.pt 98%, marketingstars.nowcanal.pt 2% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **2,1 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,1 d (e até 2,1 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 15 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Opinião

`negocios-opiniao` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 29/09/2026 a 06/10/2026 — **não chega desde 06/10** |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 1, ter 2, qua 1, qui 1, sex 1 — **1 fora do calendário** (05/10) |
| Hora prevista | 12:00 |
| Hora real | mediana 12:06 (+6 min), p90 12:07 (+7 min) |
| Artigos por edição | mediana 12, 12 a 12 |
| Artigo mais recente, idade | 11 h (p90 1,5 d, máx. 1,5 d) |
| Artigos com data de publicação | 100% (63 de 63); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 8%, p90 33%, máx. 33% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **4,4 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 2,2 d (e até 4,4 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 6 ou mais de 18 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Opinião Economistas

`negocios-opiniao-economistas` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 06/11/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 1 |
| Hora prevista | 11:30 |
| Hora real | mediana 11:34 (+4 min), p90 11:34 (+4 min) |
| Artigos por edição | mediana 7, 7 a 7 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (7 de 7); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Primeira Página

`negocios-primeira-pagina` · perfil insuficiente (2 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 2, de 05/11/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | qui 1, sex 1 |
| Hora prevista | 06:00 |
| Hora real | mediana 06:02 (+2 min), p90 06:02 (+2 min) |
| Artigos por edição | mediana 11, 11 a 11 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 91% (20 de 22); precisão: só o dia em jornaldenegocios.pt |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 95%, marketingstars.nowcanal.pt 5% |

Como se julga a próxima edição:

- Igual a uma das 2 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Sua Semana

`negocios-sua-semana` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 5, de 11/10/2026 a 08/11/2026 |
| Calendário configurado | semanal (dom) |
| Dias em que chegou | dom 5 |
| Hora prevista | 20:00 |
| Hora real | mediana 20:04 (+4 min), p90 20:09 (+9 min) |
| Artigos por edição | mediana 14, 9 a 17 |
| Artigo mais recente, idade | 20 h (p90 20 h, máx. 20 h) |
| Artigos com data de publicação | 99% (66 de 67); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 6%, máx. 6% |
| Escreve a data no topo | não é hábito (certa em 0 de 5, outra data em 2) |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 5 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **2,5 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,3 d (e até 2,5 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 26 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Tecnologia

`negocios-tecnologia` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 19, de 29/09/2026 a 06/11/2026 |
| Calendário configurado | dias úteis |
| Dias em que chegou | seg 3, ter 4, qua 4, qui 4, sex 4 — **1 fora do calendário** (05/10) |
| Hora prevista | 15:00 |
| Hora real | mediana 15:05 (+5 min), p90 15:06 (+6 min) |
| Artigos por edição | mediana 10, 9 a 10 |
| Artigo mais recente, idade | 15 h (p90 15 h, máx. 15 h) |
| Artigos com data de publicação | 95% (102 de 107); precisão: só o dia em jornaldenegocios.pt |
| Artigos já usados antes | mediana 50%, p90 67%, máx. 80% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 96%, marketingstars.nowcanal.pt 4% |

Como se julga a próxima edição:

- Igual a uma das 19 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,9 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 1,9 d) → aviso.
- Mais de 87% dos artigos já usados antes → aviso.
- Menos de 4 ou mais de 15 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Negócios — Weekend

`negocios-weekend` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 07/11/2026 a 07/11/2026 |
| Calendário configurado | semanal (sáb) |
| Dias em que chegou | sáb 1 |
| Hora prevista | 15:00 |
| Hora real | mediana 15:03 (+3 min), p90 15:03 (+3 min) |
| Artigos por edição | mediana 11, 11 a 11 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 100% (11 de 11); precisão: só o dia (sem hora) |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | jornaldenegocios.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Benfica

`record-benfica` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 05/10/2026 — **não chega desde 05/10** |
| Calendário configurado | diária |
| Dias em que chegou | seg 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 11:45 |
| Hora real | mediana 11:07 (-38 min), p90 11:08 (-37 min) |
| Artigos por edição | mediana 19, 19 a 19 |
| Artigo mais recente, idade | 1 h (p90 1 h, máx. 1 h) |
| Artigos com data de publicação | 100% (101 de 101); precisão: data e hora |
| Artigos já usados antes | mediana 11%, p90 21%, máx. 21% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 9 ou mais de 29 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Geral

`record-geral` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 25, de 30/09/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | seg 3, ter 2, qua 4, qui 4, sex 4, sáb 4, dom 4 |
| Hora prevista | 09:00 |
| Hora real | mediana 09:04 (+4 min), p90 09:08 (+8 min) |
| Artigos por edição | mediana 22, 21 a 23 |
| Artigo mais recente, idade | 1 h (p90 2 h, máx. 3 h) |
| Artigos com data de publicação | 97% (512 de 529); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 9%, máx. 45% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 25 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 10 ou mais de 35 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Record — O Melhor da Semana

`record-o-melhor-da-semana` · perfil insuficiente (1 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 1, de 06/11/2026 a 06/11/2026 |
| Calendário configurado | semanal (sex) |
| Dias em que chegou | sex 1 |
| Hora prevista | 10:00 |
| Hora real | mediana 10:03 (+3 min), p90 10:03 (+3 min) |
| Artigos por edição | mediana 11, 11 a 11 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 91% (10 de 11); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 1 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Porto

`record-porto` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 05/10/2026 — **não chega desde 05/10** |
| Calendário configurado | diária |
| Dias em que chegou | seg 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 11:00 |
| Hora real | mediana 11:06 (+6 min), p90 11:07 (+7 min) |
| Artigos por edição | mediana 19, 18 a 19 |
| Artigo mais recente, idade | 1 h (p90 1 h, máx. 1 h) |
| Artigos com data de publicação | 100% (102 de 102); precisão: data e hora |
| Artigos já usados antes | mediana 11%, p90 28%, máx. 28% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 9 ou mais de 29 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Premium

`record-premium` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 28, de 30/09/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | seg 4, ter 3, qua 4, qui 4, sex 4, sáb 4, dom 5 |
| Hora prevista | 07:00 |
| Hora real | mediana 07:05 (+5 min), p90 07:07 (+7 min) |
| Artigos por edição | mediana 19, 18 a 20 |
| Artigo mais recente, idade | 1 h (p90 2 h, máx. 3 h) |
| Artigos com data de publicação | 91% (458 de 501); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 11%, máx. 47% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 28 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 9 ou mais de 30 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Premium Plus

`record-premium-plus` · perfil insuficiente (4 de 5)

| Característica | Observado |
|---|---|
| Edições recebidas | 4, de 05/11/2026 a 08/11/2026 |
| Calendário configurado | diária |
| Dias em que chegou | qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 09:30 |
| Hora real | mediana 09:34 (+4 min), p90 09:34 (+4 min) |
| Artigos por edição | mediana 23, 3 a 28 |
| Artigo mais recente, idade | — |
| Artigos com data de publicação | 76% (56 de 74); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 4 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Idade dos artigos: ainda sem perfil (histórico curto) — só aviso, acima de 30 dias.

No histórico: nenhuma edição daria prova nem aviso.

### Record — Sporting

`record-sporting` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 05/10/2026 — **não chega desde 05/10** |
| Calendário configurado | diária |
| Dias em que chegou | seg 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 11:00 |
| Hora real | mediana 11:05 (+5 min), p90 11:07 (+7 min) |
| Artigos por edição | mediana 19, 19 a 19 |
| Artigo mais recente, idade | 1 h (p90 1 h, máx. 1 h) |
| Artigos com data de publicação | 100% (101 de 101); precisão: data e hora |
| Artigos já usados antes | mediana 11%, p90 26%, máx. 26% |
| Escreve a data no topo | não |
| Aponta para | record.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **1,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 9 ou mais de 29 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

### Vidas — Geral

`vidas-geral` · perfil completo

| Característica | Observado |
|---|---|
| Edições recebidas | 6, de 30/09/2026 a 05/10/2026 — **não chega desde 05/10** |
| Calendário configurado | diária |
| Dias em que chegou | seg 1, qua 1, qui 1, sex 1, sáb 1, dom 1 |
| Hora prevista | 10:00 |
| Hora real | mediana 11:02 (+62 min), p90 11:33 (+93 min) |
| Artigos por edição | mediana 7, 5 a 7 |
| Artigo mais recente, idade | 11 h (p90 16 h, máx. 16 h) |
| Artigos com data de publicação | 100% (39 de 39); precisão: data e hora |
| Artigos já usados antes | mediana 0%, p90 0%, máx. 0% |
| Escreve a data no topo | não |
| Aponta para | cmjornal.pt 100% |

Como se julga a próxima edição:

- Igual a uma das 6 edições anteriores (texto, ou os mesmos artigos) → **prova**.
- Artigo mais recente com mais de **2,0 d** e nada publicado desde a edição anterior → **prova**; com algo novo → aviso.
- Artigo mais recente com mais de 1,0 d (e até 2,0 d) → aviso.
- 80% ou mais dos artigos já usados antes → aviso.
- Menos de 2 ou mais de 11 artigos → aviso.

No histórico: nenhuma edição daria prova nem aviso.

## Sem histórico ou com histórico insuficiente

Nestas, a idade dos artigos só dá aviso (sem perfil) até haver 5 edições; a comparação com edições antigas e as outras verificações funcionam desde a 2.ª edição.

### Ativas que nunca chegaram à caixa (13)

| Newsletter | Calendário | Hora prevista |
|---|---|---|
| Aq Máquina — Geral (`aq-maquina-geral`) | semanal (sex) | 15:00 |
| CM — O Melhor da Semana (`cm-o-melhor-da-semana-2`) | semanal (sex) | 17:00 |
| Flash — Life & Style (`flash-life-style`) | dias úteis | 17:30 |
| Negócios — Premium Morning Call (`negocios-premium-morning-call`) | dias úteis | 09:47 |
| Negócios — Premium Plus Morning Call (`negocios-premium-plus-morning-call`) | dias úteis | 09:47 |
| Negócios — Valor Acrescentado (`negocios-valor-acrescentado`) | semanal (seg) | 12:00 |
| Record — Mercado de Transferências (`record-mercado-de-transferencias`) | diária | 10:30 |
| Sábado — A SÁBADO É TODOS OS DIAS (`sabado-a-sabado-e-todos-os-dias`) | dias úteis | 09:30 |
| Sábado — As Mais Lidas (`sabado-as-mais-lidas`) | semanal (sex) | 16:30 |
| Sábado — Capa (`sabado-capa`) | semanal (qui) | 08:00 |
| Sábado — Edição Manhã (`sabado-edicao-manha`) | diária | 10:30 |
| Sábado — Edição Noite (`sabado-edicao-noite`) | diária | 21:00 |
| Sábado — O Melhor do Mês (`sabado-o-melhor-do-mes`) | mensal (dia 1) | 12:00 |

### Com menos de 5 edições (10)

- CM — O Melhor da Semana (`cm-o-melhor-da-semana`): 1 edição, 06/11
- Negócios — A Economia das Coisas (`negocios-a-economia-das-coisas`): 1 edição, 06/11
- Negócios — Assinantes Diária (`negocios-assinantes-diaria`): 2 edições, 05/11, 06/11
- Negócios — Cripto (`negocios-cripto`): 1 edição, 05/11
- Negócios — IP (`negocios-ip`): 4 edições, 12/10, 19/10, 26/10, 02/11
- Negócios — Opinião Economistas (`negocios-opiniao-economistas`): 1 edição, 06/11
- Negócios — Primeira Página (`negocios-primeira-pagina`): 2 edições, 05/11, 06/11
- Negócios — Weekend (`negocios-weekend`): 1 edição, 07/11
- Record — O Melhor da Semana (`record-o-melhor-da-semana`): 1 edição, 06/11
- Record — Premium Plus (`record-premium-plus`): 4 edições, 05/11, 06/11, 07/11, 08/11

Há ainda 14 newsletters inativas (desligadas no Excel) sem nenhuma edição na base.
