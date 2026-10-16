import { NEWSLETTERS, estaConfigurada, newsletterPorId } from "../../../../config/newsletters.ts";
import { db } from "../../../lib/db.ts";
import { construirXlsx, type Valor } from "../../../lib/excel.ts";
import { calcularPeriodo, diasDoPeriodo, ehVista } from "../../../lib/periodo.ts";
import { chavesDe } from "../../../lib/filtros.ts";
import { dataLocal, diaMes, horaLocal } from "../../../lib/tempo.ts";
import { DESIGNACOES, type CodigoEstado, type Registo } from "../../../lib/tipos.ts";
import { ROTULO, variante } from "../../../lib/apresentacao.ts";
import { PAGAS } from "../../../../config/pagas.ts";

export const dynamic = "force-dynamic";

/**
 * Descarrega o reporting do período em .xlsx.
 *
 * Duas folhas: a matriz que a equipa reconhece do Excel, e os registos em
 * bruto, uma linha por newsletter por dia, com o `detalhe` que explica cada
 * classificação. A segunda é a que serve para filtrar e fazer tabelas dinâmicas.
 */
export function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const hoje = dataLocal();

  const pedida = url.searchParams.get("vista");
  const vista = ehVista(pedida) ? pedida : "mensal";
  // A mesma validação da página: um "ate" mal formado rebentava (500).
  const pedidaAte = url.searchParams.get("ate");
  const ancora = pedidaAte && /^\d{4}-\d{2}-\d{2}$/.test(pedidaAte) ? pedidaAte : hoje;
  const filtro = url.searchParams.get("filtro") ?? "todas";

  const periodo = calcularPeriodo(vista, ancora, hoje);
  const dias = diasDoPeriodo(periodo, hoje);

  const newsletters = NEWSLETTERS.filter(
    (n) => filtro === "todas" || chavesDe(n).includes(filtro),
  );
  const ids = new Set(newsletters.map((n) => n.id));

  const registos = db()
    .prepare(
      `SELECT * FROM registos WHERE data_prevista >= ? AND data_prevista <= ?
        ORDER BY data_prevista ASC`,
    )
    .all(dias[0], dias[dias.length - 1]) as Registo[];

  // O mesmo que o painel mostra (lib/apresentacao.ts): um 5 ainda em aberto
  // não é "Não Saiu" (a aguardar, por confirmar, ou sem prova de ausência),
  // uma newsletter que não reconhece os seus emails não pode dar "Não Saiu",
  // e um 1 sem edição anterior não prova "conteúdo atualizado". Nesses casos
  // não há código — só o símbolo e a explicação. As pagas fechadas em 5 são
  // o grupo de controlo: ficam com o 5 e contam no resumo.
  const agora = new Date();
  const especial = (r: Registo): { simbolo: string; texto: string } | null => {
    const n = newsletterPorId(r.newsletter_id);
    const v = variante({
      codigo: r.codigo_estado,
      fechado: r.fechado === 1,
      limitePassou: r.fechado === 0 && new Date(r.hora_limite) <= agora,
      semEmail: !n || !estaConfigurada(n),
      paga: PAGAS.has(r.newsletter_id),
      ressalva: r.ressalva ?? null,
    });
    if (v === null || v === "controlo") return null;
    return { simbolo: ROTULO[v].digito, texto: ROTULO[v].texto };
  };
  const estadoDe = (r: Registo): string =>
    especial(r)?.texto ??
    (PAGAS.has(r.newsletter_id) && r.codigo_estado === 5 && r.fechado === 1
      ? ROTULO.controlo.texto
      : DESIGNACOES[r.codigo_estado as CodigoEstado] ?? "");

  const indice = new Map<string, Registo>();
  for (const r of registos) indice.set(`${r.newsletter_id}|${r.data_prevista}`, r);

  // ── Folha 1: a matriz ────────────────────────────────────────────────────
  const matriz: Valor[][] = [
    ["Marca", "Newsletter", "Periodicidade", "Hora prevista", ...dias.map(diaMes)],
  ];
  for (const n of newsletters) {
    matriz.push([
      n.marca,
      n.nome,
      n.periodicidade,
      n.horaPrevista,
      ...dias.map((d) => {
        const r = indice.get(`${n.id}|${d}`);
        if (!r) return null;
        return especial(r)?.simbolo ?? r.codigo_estado;
      }),
    ]);
  }

  // ── Folha 2: os registos, um por linha ───────────────────────────────────
  const detalhados: Valor[][] = [
    [
      "Data",
      "Marca",
      "Newsletter",
      "Periodicidade",
      "Hora prevista",
      "Hora limite",
      "Hora recebida",
      "Atraso (min)",
      "Código",
      "Estado",
      "Ocorrências",
      "Fechado",
      "Detalhe",
    ],
  ];
  for (const r of registos) {
    if (!ids.has(r.newsletter_id)) continue;
    const n = newsletterPorId(r.newsletter_id);
    detalhados.push([
      r.data_prevista,
      n?.marca ?? "",
      n?.nome ?? r.newsletter_id,
      n?.periodicidade ?? "",
      n?.horaPrevista ?? "",
      horaLocal(new Date(r.hora_limite)),
      r.hora_recebida ? horaLocal(new Date(r.hora_recebida)) : null,
      r.atraso_minutos,
      especial(r) ? null : r.codigo_estado,
      estadoDe(r),
      r.nr_ocorrencias,
      r.fechado === 1 ? "Sim" : "Não",
      r.detalhe,
    ]);
  }

  // ── Folha 3: uma contagem por código, para o resumo ──────────────────────
  const resumo: Valor[][] = [
    ["Marca", "Newsletter", ...([1, 2, 3, 4, 5, 6] as CodigoEstado[]).map((c) => `${c} — ${DESIGNACOES[c]}`)],
  ];
  for (const n of newsletters) {
    const contagem = new Map<number, number>();
    for (const d of dias) {
      const r = indice.get(`${n.id}|${d}`);
      if (r && !especial(r)) contagem.set(r.codigo_estado, (contagem.get(r.codigo_estado) ?? 0) + 1);
    }
    resumo.push([n.marca, n.nome, ...[1, 2, 3, 4, 5, 6].map((c) => contagem.get(c) ?? 0)]);
  }

  const livro = construirXlsx([
    { nome: "Matriz", linhas: matriz },
    { nome: "Registos", linhas: detalhados },
    { nome: "Resumo", linhas: resumo },
  ]);

  const nome = `media-livre-${periodo.de}-a-${dias[dias.length - 1]}.xlsx`;

  return new Response(new Uint8Array(livro), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Length": String(livro.length),
      "Cache-Control": "no-store",
    },
  });
}
