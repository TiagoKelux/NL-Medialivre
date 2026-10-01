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
