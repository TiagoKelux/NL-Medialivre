import { NextResponse } from "next/server";
import { estadoCompleto } from "../../../lib/saude.ts";

export const dynamic = "force-dynamic";

/**
 * O estado do monitor em detalhe: o mesmo 200/503 do /api/saude, mais o erro
 * da última leitura tal como veio e `caixa`/`caixaCortada` (os editores ainda
 * mandam as diárias?). Fica atrás da palavra-passe do painel — no Caddy só o
 * /api/saude está isento.
 */
export function GET() {
  const { status, corpo } = estadoCompleto();
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}
