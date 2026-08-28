import { fecharVencidos } from "./registos.ts";
import { temToken } from "./graph/token.ts";

/** O ciclo de 5 em 5 minutos (§6 e §7.3), partilhado pelas rotas. */
export async function correrCiclo(): Promise<string[]> {
  const passos: string[] = [];

  // Fechar corre sempre, mesmo sem Graph: é o que faz o código 5 aparecer
  // sozinho, sem ninguém tocar em nada (critério 4).
  const fechados = fecharVencidos();
  if (fechados > 0) passos.push(`${fechados} registo(s) fechado(s)`);

  if (!temToken()) {
    passos.push("sem token do Graph — leitura da caixa saltada");
    return passos;
  }

  const { recolher } = await import("./recolha.ts");
  const r = await recolher(24);
  passos.push(
    `${r.vistas} vistas, ${r.novas} novas, ${r.repetidas} repetidas, ` +
      `${r.atribuidas} atribuídas, ${r.registosAtualizados} registo(s) atualizado(s)`,
  );
  return passos;
}
