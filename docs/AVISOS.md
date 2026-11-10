# Avisos do cliente e pausas

A página **/avisos** do painel junta duas coisas:

- **Pausas**: dias em que uma newsletter não sai por decisão do cliente
  (feriado, Natal, férias da redação). Sem email nesses dias, o registo fica
  **6 «não prevista — pausa»** e nunca «Não Saiu». Se o email chegar na mesma,
  conta como saída, como em qualquer outro dia.
- **Avisos**: emails que o cliente manda para a caixa do monitor
  (nlmedialivre@gmail.com) a dizer, em texto livre, que uma newsletter não sai
  num dia.

Nada se aplica sozinho. Cada pausa é criada ou aplicada por uma pessoa no
painel e deixa rasto em `alteracoes` (quem, quando, o quê). Anular uma pausa
não a apaga: fica marcada como anulada, e os dias voltam a ser avaliados.

## Como funciona

1. **Quem pode mandar avisos.** Só os endereços em `AVISOS_REMETENTES` no
   `.env` do servidor. Qualquer pessoa pode escrever para a caixa, por isso um
   email de outro endereço é ignorado como aviso. Um email de um endereço
   autorizado nunca conta como edição de uma newsletter, mesmo que reencaminhe
   uma. Também não entra na lista «por atribuir» nem na prova de ausência.
2. **Sem chave de IA (como está hoje).** O aviso aparece em /avisos com o
   texto do email. Quem o lê cria a pausa no formulário «Nova pausa» e carrega
   em «Dar por tratado».
3. **Com chave de IA** (`ANTHROPIC_API_KEY`). A cada ciclo (5 minutos), o
   monitor manda o texto do aviso ao Claude, com a lista de newsletters, e
   recebe propostas de pausa: newsletter, dias, motivo e o excerto exato do
   email que as justifica. Cada proposta é validada antes de aparecer:
   - a newsletter tem de existir;
   - as datas têm de ser válidas e caber nos limites (no máximo 92 dias, até
     60 dias para trás);
   - o excerto citado tem de estar mesmo no email.

   As que falham aparecem como «Inválida», com o motivo. As restantes
   aplicam-se ou rejeitam-se uma a uma. O que o email diz e não é uma pausa
   (horários novos, newsletters que acabam, pedidos) aparece em «Outras coisas
   no email», para tratar à mão.

Os avisos que chegaram sem chave podem ser lidos depois, quando a chave
existir: o ciclo apanha-os sozinho, ou usa-se o botão «Ler outra vez com IA».

## Ligar

No servidor, em `/opt/nwl/.env`:

```
AVISOS_REMETENTES=ana@exemplo.pt,outra@exemplo.pt
ANTHROPIC_API_KEY=sk-ant-...      # opcional; sem ela, trata-se à mão
AVISOS_MODELO=                    # opcional; por omissão claude-opus-5-5
```

Depois: `sudo -u monitor bash -lc 'cd /opt/nwl && pm2 restart media-livre-monitor --update-env'`.

## Custo e limites da IA

- Um aviso é um pedido curto, que custa cêntimos. O monitor lê no máximo 3
  avisos por ciclo e tenta cada um no máximo 3 vezes.
- Um email com mais de 60 000 caracteres de texto não é enviado à IA: fica
  com erro, para tratar à mão.
- Se o modelo recusar ler um aviso, o pedido passa automaticamente para outro
  modelo («fallback» do servidor). Se mesmo assim falhar, o aviso fica com
  erro.
- O texto do email é tratado como dados. Se pedir outra coisa (por exemplo,
  «ignora as regras»), isso fica em «Outras coisas», e só uma pessoa decide.
