import { NextResponse, type NextRequest } from "next/server";
import { pedidoDeOutraOrigem } from "./lib/seguranca.ts";

/**
 * Proteção contra pedidos forjados por outros sites (CSRF).
 *
 * As rotas POST /api/ciclo, /api/gerar-dia e /api/arranque não têm corpo nem
 * verificações: um formulário noutro site, aberto por quem tem a sessão do
 * painel, chegava para as disparar. Aqui recusa-se qualquer pedido que não
 * seja GET/HEAD e que o browser diga vir de outra origem.
 *
 * Corre no runtime Edge: só importa funções puras (lib/seguranca.ts).
 */
export function middleware(pedido: NextRequest) {
  const recusar = pedidoDeOutraOrigem({
    metodo: pedido.method,
    host: pedido.headers.get("host") ?? pedido.nextUrl.host,
    origin: pedido.headers.get("origin"),
    secFetchSite: pedido.headers.get("sec-fetch-site"),
  });
  if (recusar) {
    return NextResponse.json(
      { ok: false, mensagem: "Pedido de outra origem recusado." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
