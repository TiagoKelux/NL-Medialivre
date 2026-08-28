import cron from "node-cron";
import { NextResponse } from "next/server";
import { garantirDias, gerarDia } from "../../../lib/registos.ts";
import { correrCiclo } from "../../../lib/ciclo.ts";

export const dynamic = "force-dynamic";

/**
 * Onde os jobs realmente vivem (§9: node-cron dentro do mesmo processo).
 *
 * O `instrumentation.ts` do Next não aguenta imports com módulos de Node — o
 * `serverExternalPackages` não se aplica a esse bundle. Aqui, numa rota, aplica-se.
 * O instrumentation só faz um POST a esta rota no arranque.
 */

// Sobrevive ao recarregamento de módulos do dev, que de outra forma
// registaria os jobs mais do que uma vez.
const CHAVE = Symbol.for("media-livre.agendado");
const global_ = globalThis as unknown as Record<symbol, boolean>;

function registar(m: string): void {
  console.log(`[monitor ${new Date().toISOString()}] ${m}`);
}

export async function POST() {
  if (global_[CHAVE]) {
    return NextResponse.json({ ok: true, ja: "jobs já agendados" });
  }
  global_[CHAVE] = true;

  const fuso = process.env.TZ || "Europe/Lisbon";

  // §7.1 — 00h05, gerar o dia.
  cron.schedule(
    "5 0 * * *",
    () => {
      try {
        registar(`Dia gerado: ${gerarDia()} registo(s).`);
      } catch (erro) {
        registar(`Falha ao gerar o dia: ${(erro as Error).message}`);
      }
    },
    { timezone: fuso },
  );

  // §6 e §7.3 — de 5 em 5 minutos.
  cron.schedule(
    "*/5 * * * *",
    () => {
      void correrCiclo()
        .then((passos) => passos.length && registar(passos.join(" · ")))
        .catch((erro) => registar(`Falha no ciclo: ${(erro as Error).message}`));
    },
    { timezone: fuso },
  );

  // Arranque: tapar buracos deixados por uma paragem do processo (critério 1).
  const recuperados = garantirDias(30);
  const passos = await correrCiclo().catch((e) => [`falha: ${(e as Error).message}`]);

  registar(`Jobs agendados. Fuso: ${fuso}. Recuperados: ${recuperados}. ${passos.join(" · ")}`);
  return NextResponse.json({ ok: true, fuso, recuperados, passos });
}
