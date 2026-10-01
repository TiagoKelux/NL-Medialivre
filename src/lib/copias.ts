import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { db } from "./db.ts";
import { dataLocal } from "./tempo.ts";

/** Quantas cópias diárias se guardam. */
const GUARDAR = 30;

/**
 * Cópia diária da base de dados, feita com a API de backup do SQLite (segura
 * com o monitor a escrever ao mesmo tempo). Fica em data/copias; no servidor,
 * um job do sistema leva a pasta para fora da máquina.
 */
export async function copiaDiaria(): Promise<string> {
  const base = resolve(process.env.DATABASE_PATH || "./data/monitor.db");
  const pasta = join(dirname(base), "copias");
  mkdirSync(pasta, { recursive: true });

  const destino = join(pasta, `monitor-${dataLocal()}.db`);
  await db().backup(destino);

  const antigas = readdirSync(pasta)
    .filter((f) => /^monitor-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(GUARDAR);
  for (const f of antigas) rmSync(join(pasta, f), { force: true });

  return destino;
}
