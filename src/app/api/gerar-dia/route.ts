import { NextResponse } from "next/server";
import { garantirDias, gerarDia } from "../../../lib/registos.ts";

export const dynamic = "force-dynamic";

/**
 * §7.1 — o job das 00h05.
 *
 * Além do dia de hoje, tapa buracos dos últimos 30 dias: se o processo esteve
 * em baixo, os dias em falta são criados agora (critério 1).
 */
export async function POST() {
  try {
    const hoje = gerarDia();
    const recuperados = garantirDias(30);
    return NextResponse.json({ ok: true, hoje, recuperados });
  } catch (erro) {
    return NextResponse.json({ ok: false, erro: (erro as Error).message }, { status: 500 });
  }
}
