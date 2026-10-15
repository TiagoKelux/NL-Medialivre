/**
 * Aviso para fora quando o monitor deixa de funcionar.
 *
 * O aviso no painel só serve a quem o abre. Depois de cada leitura, o monitor
 * dá sinal de vida a um serviço externo (healthchecks.io ou compatível, em
 * HEALTHCHECK_URL). Se o sinal deixar de chegar — processo parado, servidor
 * em baixo, leitura a falhar — é esse serviço que manda o email, porque um
 * monitor parado não consegue avisar que parou.
 *
 * Nunca lança: uma falha a dar sinal não pode estragar o ciclo.
 */
export async function sinalDeVida(erro: Error | null): Promise<void> {
  const base = process.env.HEALTHCHECK_URL?.trim();
  if (!base) return;
  try {
    await fetch(erro ? `${base.replace(/\/$/, "")}/fail` : base, {
      method: "POST",
      body: erro ? erro.message.slice(0, 1000) : "ok",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Sem rede para o sinal: o serviço externo dá pela falta e avisa.
  }
}

// ── Caixa cortada pelo editor ──────────────────────────────────────────────

const CHAVE_CAIXA = Symbol.for("media-livre.caixa-cortada");
const global_ = globalThis as unknown as Record<symbol, string | undefined>;

/**
 * Avisa no log quando um editor deixa de mandar as diárias à caixa
 * (`saudeCaixa` → `caixaCortada`), e quando volta a mandar. Só escreve quando
 * a lista muda — não a cada ciclo de 5 minutos. Não usa serviços externos: o
 * sinal de vida acima é sobre o monitor estar a ler, e continua a sê-lo.
 *
 * Devolve a linha escrita, ou null se nada mudou. Nunca lança.
 */
export async function vigiarCaixa(
  agora: Date = new Date(),
  escrever: (linha: string) => void = (l) => console.warn(l),
): Promise<string | null> {
  try {
    const { saudeCaixa } = await import("./caixa.ts");
    const { caixaCortada } = saudeCaixa(agora);
    const assinatura = caixaCortada.map((c) => `${c.dominio}|${c.desde}`).join(";");
    if (assinatura === (global_[CHAVE_CAIXA] ?? "")) return null;
    global_[CHAVE_CAIXA] = assinatura;
    const linha =
      caixaCortada.length > 0
        ? `[monitor ${agora.toISOString()}] CAIXA CORTADA — sem edições diárias de: ` +
          caixaCortada
            .map(
              (c) =>
                `${c.dominio} desde ${c.desde} (${c.diasEsperadosSemEdicao} dia(s) esperado(s); ` +
                `última edição ${c.ultimaEdicao})`,
            )
            .join("; ") +
          `. Os "Não Saiu" destes editores ficam sem prova; reinscrever a caixa.`
        : `[monitor ${agora.toISOString()}] Caixa normalizada: os editores voltaram a mandar as diárias.`;
    escrever(linha);
    return linha;
  } catch {
    return null;
  }
}
