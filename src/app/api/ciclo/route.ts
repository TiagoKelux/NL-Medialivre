import { NextResponse } from "next/server";
import { correrCiclo } from "../../../lib/ciclo.ts";

export const dynamic = "force-dynamic";

/** Disparo manual do ciclo, útil para diagnóstico. */
export async function POST() {
  try {
    return NextResponse.json({ ok: true, passos: await correrCiclo() });
  } catch (erro) {
    return NextResponse.json({ ok: false, erro: (erro as Error).message }, { status: 502 });
  }
}
