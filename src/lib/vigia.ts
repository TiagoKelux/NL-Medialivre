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
    const linha: string =
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
        : await normalizada(agora);
    escrever(linha);
    return linha;
  } catch {
    return null;
  }
}

/**
 * Os domínios voltaram a mandar diárias — mas isso não quer dizer que todas
 * as listas voltaram: o editor corta lista a lista. Só se diz "normalizada"
 * quando nenhuma newsletter está em silêncio (`vigilanciaListas`).
 */
async function normalizada(agora: Date): Promise<string> {
  const base = `[monitor ${agora.toISOString()}] Os editores voltaram a mandar diárias de todos os domínios`;
  try {
    const { vigilanciaListas } = await import("./caixa.ts");
    const { listas } = vigilanciaListas(agora);
    if (listas.length > 0) {
      return `${base}, mas ${listas.length} newsletter(s) continuam em silêncio: ` +
        listas.map((l) => `${l.marca} ${l.nome}`).join(", ") + ".";
    }
  } catch {
    // Sem a contagem por lista: não se afirma que está tudo bem.
    return `${base} (sem a verificação por newsletter).`;
  }
  return `[monitor ${agora.toISOString()}] Caixa normalizada: os editores voltaram a mandar as diárias e nenhuma newsletter está em silêncio.`;
}

// ── Newsletters em silêncio, lista a lista ─────────────────────────────────

const CHAVE_LISTAS = Symbol.for("media-livre.listas-em-silencio");
const globalListas = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;

/**
 * Avisa no log quando uma newsletter entra em silêncio (≥ 2 edições esperadas
 * sem nada), passa a cortada, ou volta a chegar (`vigilanciaListas`). Só
 * escreve quando alguma coisa muda. Devolve as linhas escritas (vazio se nada
 * mudou). Nunca lança.
 */
export async function vigiarListas(
  agora: Date = new Date(),
  escrever: (linha: string) => void = (l) => console.warn(l),
): Promise<string[]> {
  try {
    const { vigilanciaListas } = await import("./caixa.ts");
    const { listas } = vigilanciaListas(agora);
    const antes = globalListas[CHAVE_LISTAS] ?? new Map<string, string>();
    const agoraMapa = new Map(listas.map((l) => [l.newsletterId, `${l.nivel}|${l.desde}`]));
    const carimbo = `[monitor ${agora.toISOString()}]`;
    const linhas: string[] = [];

    const mudaram = listas.filter((l) => antes.get(l.newsletterId) !== `${l.nivel}|${l.desde}`);
    if (mudaram.length > 0) {
      linhas.push(
        `${carimbo} NEWSLETTER EM SILÊNCIO — ` +
          mudaram
            .map(
              (l) =>
                `${l.marca} ${l.nome} (${l.newsletterId}) desde ${l.desde}: ${l.edicoesEmFalta} edição(ões) ` +
                `esperada(s) sem nada${l.nivel === "cortada" ? ", provavelmente cortada pelo editor" : ""}`,
            )
            .join("; ") +
          `. Ação: reinscrever esta newsletter. Os "Não Saiu" destas ficam sem prova.`,
      );
    }
    const voltaram = [...antes.keys()].filter((id) => !agoraMapa.has(id));
    if (voltaram.length > 0) {
      linhas.push(`${carimbo} Newsletter(s) de volta à caixa: ${voltaram.join(", ")}.`);
    }

    globalListas[CHAVE_LISTAS] = agoraMapa;
    for (const l of linhas) escrever(l);
    return linhas;
  } catch {
    return [];
  }
}
