import { db } from "./db.ts";
import { fecharVencidos } from "./registos.ts";
import { intervaloDeBusca } from "./edicao.ts";
import { temToken } from "./graph/token.ts";
import { temGmail } from "./gmail/config.ts";
import { registarLeitura } from "./leitura.ts";
import { sinalDeVida } from "./vigia.ts";

/**
 * Janela mínima de cada leitura: uma semana. Uma paragem do PC mais curta do
 * que isso não perde emails, porque a leitura seguinte os apanha. Os já
 * gravados não se descarregam outra vez, por isso o custo é o envelope.
 */
const JANELA_MINIMA_DIAS = 7;

/**
 * Se houver registos por fechar mais antigos do que a semana (o PC esteve
 * parado mais tempo), a leitura alarga-se até eles, até este máximo.
 */
const JANELA_MAXIMA_DIAS = 45;

/** Início da janela a ler: a semana, ou o registo em aberto mais antigo. */
function inicioDaLeitura(agora: Date): Date {
  const minima = new Date(agora.getTime() - JANELA_MINIMA_DIAS * 86_400_000);
  const maxima = new Date(agora.getTime() - JANELA_MAXIMA_DIAS * 86_400_000);
  const maisAntigo = db()
    .prepare(
      `SELECT MIN(data_prevista) AS d FROM registos WHERE fechado = 0 AND codigo_estado <> 6`,
    )
    .get() as { d: string | null };
  if (!maisAntigo.d) return minima;
  const precisa = intervaloDeBusca(maisAntigo.d).inicio;
  if (precisa >= minima) return minima;
  return precisa < maxima ? maxima : precisa;
}

// Um ciclo pode demorar mais do que 5 minutos (rede lenta, primeira leitura de
// uma janela grande). Dois ao mesmo tempo leriam a caixa duas vezes.
const CHAVE = Symbol.for("media-livre.ciclo-a-correr");
const global_ = globalThis as unknown as Record<symbol, boolean>;

/** O ciclo de 5 em 5 minutos (§6 e §7.3), partilhado pelas rotas. */
export async function correrCiclo(): Promise<string[]> {
  if (global_[CHAVE]) return ["ciclo anterior ainda a correr — saltado"];
  global_[CHAVE] = true;
  try {
    return await ciclo();
  } finally {
    global_[CHAVE] = false;
  }
}

async function ciclo(): Promise<string[]> {
  const passos: string[] = [];

  if (!temGmail() && !temToken()) {
    const erro = new Error("sem Gmail nem token do Graph configurados");
    registarLeitura(erro);
    await sinalDeVida(erro);
    passos.push("sem Gmail nem token do Graph — leitura da caixa saltada");
    return passos;
  }

  // Primeiro ler, depois fechar: um registo só fecha como "Não Saiu" com uma
  // leitura bem-sucedida feita depois do limite. Se a leitura falhar, nada
  // fecha — os registos ficam "Por confirmar" em vez de falsos "Não Saiu".
  const agora = new Date();
  const desde = inicioDaLeitura(agora);
  const { recolher } = await import("./recolha.ts");
  let r;
  try {
    r = await recolher((agora.getTime() - desde.getTime()) / 3_600_000);
  } catch (erro) {
    registarLeitura(erro as Error);
    await sinalDeVida(erro as Error);
    throw erro;
  }
  registarLeitura(null, desde);
  await sinalDeVida(null);
  passos.push(
    `${r.vistas} vistas, ${r.novas} novas, ${r.repetidas} repetidas, ` +
      `${r.atribuidas} atribuídas, ${r.registosAtualizados} registo(s) atualizado(s)`,
  );

  // `agora` é o momento em que a leitura começou: o que chegou depois pode não
  // ter sido visto, por isso não serve de prova.
  const fechados = fecharVencidos({ ok: agora, desde });
  if (fechados > 0) passos.unshift(`${fechados} registo(s) fechado(s)`);

  return passos;
}
