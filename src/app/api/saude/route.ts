import { NextResponse } from "next/server";
import { respostaSaude } from "../../../lib/saude.ts";

export const dynamic = "force-dynamic";

/**
 * Saúde do monitor, para verificações externas: 200 se a caixa foi lida há
 * menos de 15 minutos e a última tentativa não falhou, 503 caso contrário.
 *
 * É pública (fica fora da palavra-passe no Caddy): só diz se está saudável e
 * quando leu. O erro em bruto e o estado da caixa por editor estão em
 * /api/estado, atrás da palavra-passe — ver lib/saude.ts.
 */
export function GET() {
  const { status, corpo } = respostaSaude();
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}
