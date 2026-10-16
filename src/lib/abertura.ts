/**
 * Marcar como aberto: carregar o pixel de abertura de cada email novo.
 *
 * Os editores cortam as diárias a quem nunca abre os emails. A caixa é lida
 * por IMAP, que nunca carrega imagens: para o Echobox, nlmedialivre@gmail.com
 * nunca abriu nada, e a 06/10 (uma semana depois da inscrição) as diárias de
 * CM, Record, Negócios e Máxima deixaram de chegar; as da FLASH! a 15/10.
 *
 * Todas as edições (119 de 119, 29/09 a 15/10) trazem o pixel do Amazon SES,
 * `https://<id>.r.<região>.awstrack.me/I0/…`. Pedi-lo é o que um cliente de
 * email faz ao mostrar as imagens. Só esse pixel: nunca um link (isso seria
 * um clique) nem outras imagens. Uma falha nunca trava a recolha.
 *
 * Desliga-se com MARCAR_ABERTURA=0.
 */
const PIXEL = /<img\b[^>]*?\bsrc\s*=\s*["'](https:\/\/[a-z0-9-]+\.r\.[a-z0-9-]+\.awstrack\.me\/I0\/[^"'\s]+)["']/i;

/** O endereço do pixel de abertura do SES, ou null se o email não tiver. */
export function pixelDeAbertura(html: string): string | null {
  const m = html.match(PIXEL);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

export function marcarAberturaAtivo(): boolean {
  return process.env.MARCAR_ABERTURA !== "0";
}

/**
 * Pede os pixéis, um a um, com tempo limite. Devolve quantos responderam.
 * `pedir` existe para os testes; por defeito é o `fetch` do Node, sem cookies.
 */
export async function marcarAbertos(
  htmls: string[],
  pedir: (url: string) => Promise<{ ok: boolean }> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" }),
): Promise<number> {
  if (!marcarAberturaAtivo()) return 0;
  let ok = 0;
  for (const html of htmls) {
    const url = pixelDeAbertura(html);
    if (!url) continue;
    try {
      if ((await pedir(url)).ok) ok++;
    } catch {
      // Rede em baixo, tempo esgotado: fica por abrir, mais nada.
    }
  }
  return ok;
}
