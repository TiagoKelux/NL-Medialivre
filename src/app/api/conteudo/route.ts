import { newsletterPorId } from "../../../../config/newsletters.ts";
import { emailDoDia, registoDe } from "../../../lib/registos.ts";
import { construirFicheiro, markdownParaHtml } from "../../../lib/markdown.ts";
import { horaLocal } from "../../../lib/tempo.ts";
import { DESIGNACOES, type CodigoEstado } from "../../../lib/tipos.ts";

export const dynamic = "force-dynamic";

/**
 * A newsletter inteira, convertida em Markdown.
 *
 *   /api/conteudo?newsletter=<id>&data=<AAAA-MM-DD>              → página legível
 *   /api/conteudo?newsletter=<id>&data=<AAAA-MM-DD>&descarregar=1 → ficheiro .md
 *
 * O Markdown é gerado a partir do `corpo_html` que já se guarda desde o
 * primeiro dia — não há nada de novo para armazenar.
 */
export function GET(pedido: Request) {
  const url = new URL(pedido.url);
  const id = url.searchParams.get("newsletter") ?? "";
  const data = url.searchParams.get("data") ?? "";
  const descarregar = url.searchParams.get("descarregar") === "1";

  const n = newsletterPorId(id);
  if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return new Response("Parâmetros inválidos.", { status: 400 });
  }

  const email = emailDoDia(id, data);
  if (!email) {
    return new Response("Não há newsletter guardada para este dia.", { status: 404 });
  }

  const registo = registoDe(id, data);
  const codigo = (registo?.codigo_estado ?? 1) as CodigoEstado;

  const md = construirFicheiro(
    {
      marca: n.marca,
      nome: n.nome,
      data,
      assunto: email.assunto,
      remetente: email.remetente,
      horaRecebida: horaLocal(new Date(email.recebido_em)),
      codigo,
      estado: DESIGNACOES[codigo],
      detalhe: registo?.detalhe ?? "",
    },
    email.corpo_html,
  );

  const nomeFicheiro = `${data}-${id}.md`;

  if (descarregar) {
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeFicheiro}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // O frontmatter é contexto para o ficheiro, não para a leitura no ecrã.
  const semFrontmatter = md.replace(/^---[\s\S]*?\n---\n/, "");
  const escapar = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const pagina = `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(n.marca)} · ${escapar(n.nome)} — ${data}</title>
<style>
  :root { --azul:#3b47fa; --roxo:#e509b6; --texto:#14171c; --fraco:#5c6673; --borda:#e2e5ea; }
  * { box-sizing:border-box; }
  body { margin:0; background:#fff; color:var(--texto);
         font:16px/1.62 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .folha { max-width:720px; margin:0 auto; padding:32px 22px 80px; }
  h1 { font-size:24px; letter-spacing:-0.02em; margin:0 0 6px;
       background:linear-gradient(95deg,var(--roxo),var(--azul) 78%);
       -webkit-background-clip:text; background-clip:text; color:transparent; width:fit-content; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:0.07em; color:var(--fraco);
       margin:32px 0 10px; }
  h3,h4,h5,h6 { font-size:17px; margin:24px 0 8px; }
  p { margin:0 0 14px; }
  a { color:var(--azul); }
  ul { padding-left:20px; margin:0 0 16px; }
  li { margin-bottom:7px; }
  hr { border:none; border-top:1px solid var(--borda); margin:28px 0; }
  img { max-width:100%; height:auto; border-radius:8px; margin:10px 0; }
  .barra { display:flex; gap:10px; align-items:center; flex-wrap:wrap;
           padding-bottom:16px; border-bottom:1px solid var(--borda); margin-bottom:8px; }
  .barra a { text-decoration:none; border:1px solid var(--borda); border-radius:6px;
             padding:5px 11px; font-size:13px; color:var(--fraco); }
  .barra a:hover { border-color:var(--azul); color:var(--texto); }
</style></head><body><div class="folha">
<div class="barra">
  <a href="/?vista=diaria&amp;ate=${data}">‹ Voltar ao monitor</a>
  <a href="/api/conteudo?newsletter=${encodeURIComponent(id)}&amp;data=${data}&amp;descarregar=1">Descarregar .md</a>
</div>
${markdownParaHtml(semFrontmatter)}
</div></body></html>`;

  return new Response(pagina, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
