import { db } from "../../../lib/db.ts";
import { CABECALHOS_EMAIL, limparHtmlEmail } from "../../../lib/seguranca.ts";

export const dynamic = "force-dynamic";

/**
 * Um email guardado, tal como chegou: /api/email?id=<n>.
 *
 * O HTML é de terceiros. Serve-se numa caixa de areia (CSP `sandbox`, sem
 * scripts e com origem opaca), para não poder correr código nem chegar ao
 * painel. Sem formulários nem `<base>`, e o `<meta http-equiv>` (o refresh,
 * que redireciona sem precisar de scripts) sai do HTML antes de se servir.
 * As imagens carregam, para se ver o email como ele é.
 */
export function GET(pedido: Request) {
  const id = Number(new URL(pedido.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return new Response("Pedido inválido.", { status: 400 });
  }
  const email = db().prepare(`SELECT corpo_html FROM emails WHERE id = ?`).get(id) as
    | { corpo_html: string }
    | undefined;
  if (!email) return new Response("Email não encontrado.", { status: 404 });

  // Sem `<meta http-equiv>` nem `<base>`: um refresh redireciona mesmo sem scripts.
  const html = limparHtmlEmail(email.corpo_html || "") || "<p>(email sem corpo)</p>";
  return new Response(html, { headers: { ...CABECALHOS_EMAIL } });
}
