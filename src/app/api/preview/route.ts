import { NextResponse } from "next/server";
import { newsletterPorId } from "../../../../config/newsletters.ts";
import { emailDoDia } from "../../../lib/registos.ts";
import { resumoExecutivo } from "../../../lib/markdown.ts";
import { horaLocal } from "../../../lib/tempo.ts";

export const dynamic = "force-dynamic";

/**
 * O resumo executivo de uma edição, para o cartão que aparece ao passar o rato.
 *
 * É pedido só quando alguém paira sobre a célula, e não vem no payload da
 * página: com 62 newsletters × 30 dias, mandar o resumo de tudo à cabeça seriam
 * centenas de KB para mostrar meia dúzia deles.
 */
export function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const id = url.searchParams.get("newsletter") ?? "";
  const data = url.searchParams.get("data") ?? "";

  const n = newsletterPorId(id);
  if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ erro: "parâmetros inválidos" }, { status: 400 });
  }

  const email = emailDoDia(id, data);
  if (!email) return NextResponse.json({ vazio: true });

  return NextResponse.json({
    marca: n.marca,
    nome: n.nome,
    assunto: email.assunto,
    hora: horaLocal(new Date(email.recebido_em)),
    artigos: resumoExecutivo(email.corpo_html, 6),
  });
}
