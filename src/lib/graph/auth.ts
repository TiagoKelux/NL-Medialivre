import { PublicClientApplication } from "@azure/msal-node";
import { guardarToken, lerToken, temToken } from "./token.ts";

/**
 * Autenticação no Microsoft Graph (§6 da spec).
 *
 * Fluxo *device code* com permissão delegada `Mail.Read`. Autentica-se uma vez
 * pelo terminal (`npm run auth`) e guarda-se o refresh token na base de dados.
 * Evita esperar pelo consentimento de administrador do tenant.
 */

const ESCOPOS = ["Mail.Read"];

function cliente(): PublicClientApplication {
  const clientId = process.env.GRAPH_CLIENT_ID;
  const tenantId = process.env.GRAPH_TENANT_ID;
  if (!clientId || !tenantId) {
    throw new Error(
      "Faltam GRAPH_CLIENT_ID e/ou GRAPH_TENANT_ID. Copia .env.example para .env e preenche.",
    );
  }
  return new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
  });
}

/**
 * O MSAL não expõe o refresh token diretamente; está na cache serializada.
 * Tiramo-lo de lá para o guardar na coluna que a spec define.
 */
function extrairRefreshToken(pca: PublicClientApplication): string | null {
  try {
    const cache = JSON.parse(pca.getTokenCache().serialize()) as {
      RefreshToken?: Record<string, { secret?: string }>;
    };
    const entradas = Object.values(cache.RefreshToken ?? {});
    return entradas[0]?.secret ?? null;
  } catch {
    return null;
  }
}

export { temToken };

/** Corre uma vez, no terminal. Imprime o código para colar em microsoft.com/devicelogin. */
export async function autenticarPorDeviceCode(): Promise<void> {
  const pca = cliente();
  const resultado = await pca.acquireTokenByDeviceCode({
    scopes: ESCOPOS,
    deviceCodeCallback: (resposta) => console.log(`\n${resposta.message}\n`),
  });

  if (!resultado) throw new Error("A autenticação não devolveu resultado.");

  const refreshToken = extrairRefreshToken(pca);
  if (!refreshToken) {
    throw new Error(
      "Autenticou mas não veio refresh token. Confirma que a app tem 'Allow public client flows' ativo.",
    );
  }

  const expira = resultado.expiresOn ?? new Date(Date.now() + 3_600_000);
  guardarToken(refreshToken, expira.toISOString());
  console.log(`Autenticado como ${resultado.account?.username ?? "(desconhecido)"}.`);
}

/** Access token válido, renovado a partir do refresh token quando preciso. */
let emMemoria: { token: string; expiraMs: number } | null = null;

export async function obterAccessToken(): Promise<string> {
  // Margem de 60 s para não usar um token que expira a meio do pedido.
  if (emMemoria && emMemoria.expiraMs > Date.now() + 60_000) return emMemoria.token;

  const guardado = lerToken();
  if (!guardado) {
    throw new Error("Sem token do Graph. Corre `npm run auth` uma vez para autenticar.");
  }

  const pca = cliente();
  const resultado = await pca.acquireTokenByRefreshToken({
    refreshToken: guardado.refresh_token,
    scopes: ESCOPOS,
  });

  if (!resultado?.accessToken) {
    throw new Error("Não foi possível renovar o access token. Corre `npm run auth` outra vez.");
  }

  const expiraMs = (resultado.expiresOn ?? new Date(Date.now() + 3_600_000)).getTime();
  // O refresh token roda: guardar o novo, senão a sessão morre passados uns dias.
  const rodado = extrairRefreshToken(pca) ?? guardado.refresh_token;
  guardarToken(rodado, new Date(expiraMs).toISOString());

  emMemoria = { token: resultado.accessToken, expiraMs };
  return resultado.accessToken;
}
