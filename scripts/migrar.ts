/**
 * Cria a base de dados e gera as linhas dos últimos 30 dias.
 *   npm run migrar
 */
import { db } from "../src/lib/db.ts";
import { garantirDias } from "../src/lib/registos.ts";

db();
console.log(`Base de dados pronta. ${garantirDias(45)} registo(s) criados.`);
