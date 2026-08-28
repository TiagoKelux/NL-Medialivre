/**
 * Passo 2 da ordem de implementação: autenticar uma vez, pelo terminal.
 *   npm run auth
 * Imprime um código para colar em https://microsoft.com/devicelogin.
 */
import { autenticarPorDeviceCode } from "../src/lib/graph/auth.ts";

await autenticarPorDeviceCode();
console.log("Refresh token guardado. Já podes correr `npm run dev`.");
