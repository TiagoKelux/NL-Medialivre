/**
 * Corre um ciclo de recolha à mão, sem esperar pelo agendador.
 *   npm run recolher
 */
import { correrCiclo } from "../src/lib/ciclo.ts";

const passos = await correrCiclo();
console.log(passos.join("\n"));
