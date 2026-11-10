import { NextResponse } from "next/server";
import { aplicarProposta, arquivarAviso, listarAvisos, reinterpretarAviso, rejeitarProposta } from "../../../lib/avisos.ts";
import { anularPausa, criarPausa, listarPausas, type ResultadoPausa } from "../../../lib/pausas.ts";

export const dynamic = "force-dynamic";

/**
 * Avisos do cliente e pausas (página /avisos). Só JSON: um formulário de
 * outro site não consegue enviar `application/json` sem autorização prévia
 * do browser (e o middleware recusa outras origens).
 *
 *   GET → avisos e pausas
 *   POST { acao: "criar-pausa", newsletterId, de, ate, motivo }
 *        { acao: "anular-pausa", id }
 *        { acao: "aplicar", avisoId, indice } | { acao: "rejeitar", avisoId, indice }
 *        { acao: "arquivar", avisoId } | { acao: "reinterpretar", avisoId }
 */

function utilizador(pedido: Request): string | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec((pedido.headers.get("authorization") ?? "").trim());
  if (!m) return null;
  try {
    const nome = Buffer.from(m[1], "base64").toString("utf8").split(":")[0].trim();
    return nome ? nome.slice(0, 60) : null;
  } catch {
    return null;
  }
}

const inteiro = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const texto = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : null;

export function GET() {
  return NextResponse.json({ avisos: listarAvisos(), pausas: listarPausas() });
}

export async function POST(pedido: Request) {
  if (!(pedido.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 415 });
  }
  let corpo: Record<string, unknown>;
  try {
    const lido = (await pedido.json()) as unknown;
    if (!lido || typeof lido !== "object") throw new Error();
    corpo = lido as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 400 });
  }

  const quem = utilizador(pedido);
  const avisoId = inteiro(corpo.avisoId);
  const indice = inteiro(corpo.indice);
  let r: ResultadoPausa;
  try {
    switch (corpo.acao) {
      case "criar-pausa": {
        const newsletterId = texto(corpo.newsletterId, 100);
        const de = texto(corpo.de, 10);
        const ate = texto(corpo.ate, 10) ?? de;
        const motivo = texto(corpo.motivo, 200);
        r =
          newsletterId && de && ate && motivo
            ? criarPausa({ newsletterId, de, ate, motivo }, { tipo: "painel" }, quem)
            : { ok: false, mensagem: "Escolha a newsletter, as datas e o motivo." };
        break;
      }
      case "anular-pausa": {
        const id = inteiro(corpo.id);
        r = id ? anularPausa(id, quem) : { ok: false, mensagem: "Pausa inválida." };
        break;
      }
      case "aplicar":
        r = avisoId !== null && indice !== null ? aplicarProposta(avisoId, indice, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      case "rejeitar":
        r = avisoId !== null && indice !== null ? rejeitarProposta(avisoId, indice, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      case "arquivar":
        r = avisoId !== null ? arquivarAviso(avisoId, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      case "reinterpretar":
        r = avisoId !== null ? reinterpretarAviso(avisoId, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      default:
        r = { ok: false, mensagem: "Ação desconhecida." };
    }
  } catch (erro) {
    console.error("[avisos]", erro);
    r = { ok: false, mensagem: "Erro interno: recarregue a página e confirme o estado antes de repetir." };
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
