/**
 * Newsletters pagas: as que, na coluna "Segmento" da folha "Horário" do
 * Excel, só vão para Assinantes (incluindo Premium Plus) — sem Registados.
 * A Record Premium vai também para Registados, mas é Premium no nome e no
 * produto, por isso conta. A Cripto está aberta a Registados só durante um
 * mês (o asterisco no Excel), por isso conta como paga.
 *
 * Fica fora de `newsletters.ts` porque esse ficheiro é gerado pelo importador.
 */
export const PAGAS = new Set<string>([
  "record-premium",
  "negocios-assinantes-diaria",
  "sabado-a-sabado-e-todos-os-dias",
  "record-premium-plus",
  "record-euro-2020",
  "negocios-premium-morning-call",
  "negocios-premium-plus-morning-call",
  "record-o-melhor-da-semana",
  "negocios-dow-jones-mercados-globais",
  "negocios-opiniao-economistas",
  "negocios-cripto",
  "negocios-valor-acrescentado",
  "negocios-a-economia-das-coisas",
  "cm-o-melhor-da-semana",
  "negocios-dow-jones-fecho",
  "record-jo2020",
  "record-mundial-premium-2022",
  "negocios-assinantes-mensal",
  "record-dois-dedos-de-conversa",
]);
