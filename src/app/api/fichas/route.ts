import { NextResponse } from "next/server";
import { fichas } from "../../../lib/fichas.ts";

export const dynamic = "force-dynamic";

/**
 * As fichas das newsletters (lib/fichas.ts): o perfil de cada uma, aprendido
 * com os últimos 90 dias, e os sinais da última edição. Fica atrás da
 * palavra-passe do painel, como o resto.
 */
export function GET() {
  return NextResponse.json(fichas(), { headers: { "Cache-Control": "no-store" } });
}
