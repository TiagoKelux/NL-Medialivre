import { get as getHttps } from "node:https";
import { get as getHttp } from "node:http";

/**
 * Pedir uma página pública: o módulo `https` do Node, não o `fetch`.
 *
 * Ao recolher as datas de 2775 artigos, o `fetch` (undici) do Node 24 deitou o
 * processo abaixo com um erro interno lançado fora de qualquer promessa
 * (`assert(!this.paused)` em `Parser.finish`): não há try/catch que o apanhe.
 * No monitor isso pararia a leitura da caixa. Aqui cada falha (rede, tempo,
 * resposta estranha) vira `{ estado: 0 }` e nada é lançado.
 */
export interface Resposta {
  /** Código HTTP; 0 = sem resposta (rede, tempo esgotado). */
  estado: number;
  corpo: string;
}

export type PedirPagina = (url: string) => Promise<Resposta>;

/** O que se lê de uma página, no máximo: as datas estão no <head>. */
const MAXIMO_BYTES = 400_000;

export function pedirPagina(url: string, tempoMs = 15_000, saltos = 3): Promise<Resposta> {
  return new Promise((resolver) => {
    let feito = false;
    const fim = (r: Resposta) => {
      if (!feito) {
        feito = true;
        resolver(r);
      }
    };
    let pedido: ReturnType<typeof getHttps>;
    try {
      const get = url.startsWith("http://") ? getHttp : getHttps;
      pedido = get(
        url,
        { headers: { "user-agent": "Mozilla/5.0 (compatible; media-livre-monitor)" }, timeout: tempoMs },
        (res) => {
          const estado = res.statusCode ?? 0;
          const destino = res.headers.location;
          if (estado >= 300 && estado < 400 && destino && saltos > 0) {
            res.resume();
            let seguinte: string;
            try {
              seguinte = new URL(destino, url).toString();
            } catch {
              fim({ estado, corpo: "" });
              return;
            }
            void pedirPagina(seguinte, tempoMs, saltos - 1).then(fim);
            return;
          }
          let corpo = "";
          res.setEncoding("utf8");
          res.on("data", (pedaco: string) => {
            corpo += pedaco;
            // Chega o início da página: corta-se a ligação e usa-se o que veio.
            if (corpo.length >= MAXIMO_BYTES) {
              fim({ estado, corpo });
              res.destroy();
            }
          });
          res.on("end", () => fim({ estado, corpo }));
          res.on("error", () => fim({ estado, corpo }));
          res.on("close", () => fim({ estado, corpo }));
        },
      );
    } catch {
      fim({ estado: 0, corpo: "" });
      return;
    }
    pedido.on("timeout", () => pedido.destroy());
    pedido.on("error", () => fim({ estado: 0, corpo: "" }));
  });
}
