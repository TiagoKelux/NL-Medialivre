import { NextResponse } from "next/server";
import { respostaSaude } from "../../../lib/saude.ts";

export const dynamic = "force-dynamic";

/**
 * Saúde do monitor, para verificações externas: 200 se a caixa foi lida há
 * menos de 15 minutos e a última tentativa não falhou, 503 caso contrário.
 * Não devolve conteúdo de emails.
 *
 * Traz também `caixa` e `caixaCortada` (os editores ainda mandam as
 * diárias?), que NÃO mexem no 200/503 — ver lib/saude.ts.
 */
export function GET() {
  const { status, corpo } = respostaSaude();
  return NextResponse.json(corpo, { status });
}
