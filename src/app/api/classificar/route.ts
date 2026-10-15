import { NextResponse } from "next/server";
import { atribuir, excluir, removerExclusao, removerRegra, type Resultado } from "../../../lib/regras.ts";

export const dynamic = "force-dynamic";

/**
 * As ações da página "Por classificar". Só JSON: um formulário de outro site
 * não consegue enviar `application/json` sem autorização prévia do browser.
 *
 *   { acao: "atribuir", emailId, newsletterId, marca }
 *   { acao: "excluir", emailId, tipo: "assunto" | "mensagem" }
 *   { acao: "remover-regra", id }
 *   { acao: "remover-exclusao", id }
 */

/** O utilizador da autenticação básica do proxy, se vier no pedido. A senha nunca se guarda. */
function utilizador(pedido: Request): string | null {
  const cabecalho = pedido.headers.get("authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(cabecalho.trim());
  if (!m) return null;
  try {
    const nome = Buffer.from(m[1], "base64").toString("utf8").split(":")[0].trim();
    return nome ? nome.slice(0, 60) : null;
  } catch {
    return null;
  }
}

const inteiro = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
const texto = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null;

export async function POST(pedido: Request) {
  if (!(pedido.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 415 });
  }

  let corpo: Record<string, unknown>;
  try {
    const lido = (await pedido.json()) as unknown;
    if (!lido || typeof lido !== "object") throw new Error();
    corpo = lido as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 400 });
  }

  const quem = utilizador(pedido);
  let r: Resultado;
  try {
    switch (corpo.acao) {
      case "atribuir": {
        const emailId = inteiro(corpo.emailId);
        const newsletterId = texto(corpo.newsletterId, 100);
        const marca = texto(corpo.marca, 200);
        r =
          emailId && newsletterId && marca
            ? atribuir(emailId, newsletterId, marca, quem)
            : { ok: false, mensagem: "Escolha a newsletter e a marca." };
        break;
      }
      case "excluir": {
        const emailId = inteiro(corpo.emailId);
        const tipo = corpo.tipo === "assunto" || corpo.tipo === "mensagem" ? corpo.tipo : null;
        r =
          emailId && tipo
            ? excluir(emailId, tipo, quem)
            : { ok: false, mensagem: "Pedido inválido." };
        break;
      }
      case "remover-regra": {
        const id = inteiro(corpo.id);
        r = id ? removerRegra(id, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      }
      case "remover-exclusao": {
        const id = inteiro(corpo.id);
        r = id ? removerExclusao(id, quem) : { ok: false, mensagem: "Pedido inválido." };
        break;
      }
      default:
        r = { ok: false, mensagem: "Ação desconhecida." };
    }
  } catch (erro) {
    console.error("[classificar]", erro);
    return NextResponse.json(
      { ok: false, mensagem: "Erro interno: nada foi alterado. Tente outra vez." },
      { status: 500 },
    );
  }

  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
