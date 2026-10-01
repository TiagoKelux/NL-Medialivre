import { NextResponse } from "next/server";
import { estadoLeitura } from "../../../lib/leitura.ts";

export const dynamic = "force-dynamic";

/** Acima disto sem uma leitura boa, alguma coisa parou: o ciclo é de 5 min. */
const MAXIMO_MIN = 15;

/**
 * Saúde do monitor, para verificações externas: 200 se a caixa foi lida há
 * menos de 15 minutos e a última tentativa não falhou, 503 caso contrário.
 * Não devolve conteúdo de emails.
 */
export function GET() {
  const { ok, falha } = estadoLeitura();
  const minutos = ok ? Math.floor((Date.now() - new Date(ok).getTime()) / 60_000) : null;
  const saudavel = !falha && minutos !== null && minutos <= MAXIMO_MIN;
  return NextResponse.json(
    { saudavel, ultimaLeitura: ok, minutosDesdeLeitura: minutos, falha: falha?.erro ?? null },
    { status: saudavel ? 200 : 503 },
  );
}
