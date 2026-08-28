/**
 * Ponto de arranque do processo.
 *
 * Não pode ter imports: o Next compila este ficheiro num bundle próprio, ao
 * qual o `serverExternalPackages` não se aplica, e qualquer dependência que
 * toque em módulos de Node (o SQLite nativo, o MSAL, o node-cron) faz falhar
 * o servidor inteiro. Por isso aqui só há `fetch`: os jobs são agendados em
 * /api/arranque, já do lado do servidor.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  let tentativas = 0;

  const arrancar = async (): Promise<void> => {
    try {
      const resposta = await fetch(`${base}/api/arranque`, { method: "POST" });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      console.log(`[monitor] arranque pedido a ${base}.`);
    } catch (erro) {
      // O servidor ainda pode estar a subir; tenta outra vez.
      if (++tentativas <= 10) {
        setTimeout(() => void arrancar(), 5000);
      } else {
        console.log(`[monitor] arranque falhou: ${(erro as Error).message}`);
      }
    }
  };

  setTimeout(() => void arrancar(), 3000);
}
