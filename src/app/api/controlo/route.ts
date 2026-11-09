import { NextResponse } from "next/server";
import { comparacao, importarControlo } from "../../../lib/importar-controlo.ts";

export const dynamic = "force-dynamic";

/**
 * O controlo manual do cliente (o Excel "Newsletters Horários").
 *
 *   GET  → importações e cruzamento dos últimos 60 dias
 *   POST → importa o .xlsx enviado no corpo (application/octet-stream,
 *          nome do ficheiro em `x-ficheiro`). Só se lê; o ficheiro não muda.
 *
 * O tipo do corpo obriga o browser a pedir autorização antes de um pedido de
 * outro site (e o middleware recusa outras origens).
 */

const MAXIMO = 20 * 1024 * 1024;

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

export function GET() {
  return NextResponse.json(comparacao());
}

export async function POST(pedido: Request) {
  if (!(pedido.headers.get("content-type") ?? "").toLowerCase().startsWith("application/octet-stream")) {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 415 });
  }
  const corpo = Buffer.from(await pedido.arrayBuffer());
  if (corpo.length === 0 || corpo.length > MAXIMO) {
    return NextResponse.json({ ok: false, mensagem: "Ficheiro vazio ou maior do que 20 MB." }, { status: 400 });
  }
  let ficheiro = "controlo.xlsx";
  try {
    ficheiro = decodeURIComponent(pedido.headers.get("x-ficheiro") ?? ficheiro).slice(0, 200);
  } catch {
    /* nome estranho: fica o genérico */
  }
  const r = importarControlo(corpo, ficheiro, utilizador(pedido));
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
