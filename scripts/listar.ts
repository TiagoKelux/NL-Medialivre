/**
 * Passo 2 da ordem de implementação: listar emails na consola, sem gravar.
 * Serve para descobrir os `remetentes` e o `padraoAssunto` reais de cada
 * newsletter, que são o único bloqueio da configuração.
 *   npm run listar
 */
import { listarNaConsola } from "../src/lib/graph/mail.ts";

await listarNaConsola(24);
