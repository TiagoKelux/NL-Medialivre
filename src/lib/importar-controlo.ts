import { db } from "./db.ts";
import { newsletterPorId } from "../../config/newsletters.ts";
import { comparar, guardarControlo, lerControlo, ultimasImportacoes, type Categoria, type Diferenca, type Leitura } from "./controlo-cliente.ts";
import { reavaliar } from "./registos.ts";
import { dataLocal, somarDias } from "./tempo.ts";

/**
 * Importar o Excel de controlo do cliente: ler, gravar as marcas e reavaliar
 * os dias em que a marca mudou e a nossa caixa não tem email (com email vale
 * o que o monitor mediu; a marca do cliente não lhe mexe). Fica à parte de
 * controlo-cliente.ts porque precisa do `reavaliar`, que por sua vez lê as
 * marcas.
 */

export interface ResultadoImportacao {
  ok: boolean;
  mensagem: string;
  leitura?: Pick<Leitura, "folhas" | "ignoradas">;
  marcas?: number;
  alteradas?: number;
  reavaliados?: number;
}

export function importarControlo(conteudo: Buffer, ficheiro: string, quem: string | null): ResultadoImportacao {
  let leitura: Leitura;
  try {
    leitura = lerControlo(conteudo);
  } catch (e) {
    return { ok: false, mensagem: `Não foi possível ler o ficheiro: ${(e as Error).message}` };
  }
  const erros = leitura.folhas.filter((f) => f.erro);
  if (leitura.marcas.length === 0) {
    const porque = erros.map((f) => `${f.nome}: ${f.erro}`).join("; ");
    return {
      ok: false,
      mensagem: `Nenhuma marca lida. ${porque || 'Não encontrei as folhas "TODOS OS DIAS", "2ª a 6ª" e "Semanal".'}`,
      leitura,
    };
  }

  const { alteradas } = guardarControlo(leitura, ficheiro, quem);
  const semEmail = db().prepare(
    `SELECT 1 FROM registos WHERE newsletter_id = ? AND data_prevista = ? AND nr_ocorrencias = 0`,
  );
  let reavaliados = 0;
  for (const a of alteradas) {
    if (!newsletterPorId(a.newsletterId)) continue;
    if (!semEmail.get(a.newsletterId, a.data)) continue;
    if (reavaliar(a.newsletterId, a.data)) reavaliados++;
  }
  return {
    ok: true,
    mensagem:
      `${leitura.marcas.length} marcas lidas (${alteradas.length} novas ou mudadas), ${reavaliados} dias atualizados.` +
      (erros.length ? ` Folhas com problemas: ${erros.map((f) => `${f.nome} (${f.erro})`).join(", ")}.` : ""),
    leitura: { folhas: leitura.folhas, ignoradas: leitura.ignoradas },
    marcas: leitura.marcas.length,
    alteradas: alteradas.length,
    reavaliados,
  };
}

export interface LinhaComparacao {
  newsletterId: string;
  marca: string;
  nome: string;
  porCategoria: Partial<Record<Categoria, Diferenca[]>>;
}

export interface Comparacao {
  de: string;
  ate: string;
  importacoes: ReturnType<typeof ultimasImportacoes>;
  totais: Record<Categoria, number>;
  linhas: LinhaComparacao[];
}

/** O que a página /controlo mostra: as importações e o cruzamento dos últimos `dias`. */
export function comparacao(dias = 60, hoje: string = dataLocal()): Comparacao {
  const de = somarDias(hoje, -dias);
  const ate = somarDias(hoje, -1);
  const totais: Record<Categoria, number> = {
    "confirmada-pelo-cliente": 0,
    "nao-saiu-confirmado": 0,
    "desativada-pelo-cliente": 0,
    "codigo-diferente": 0,
    "cliente-nao-recebeu": 0,
    igual: 0,
  };
  const porNl = new Map<string, LinhaComparacao>();
  for (const d of comparar(de, ate)) {
    totais[d.categoria]++;
    if (d.categoria === "igual") continue;
    const n = newsletterPorId(d.newsletterId);
    let l = porNl.get(d.newsletterId);
    if (!l) {
      l = { newsletterId: d.newsletterId, marca: n?.marca ?? "", nome: n?.nome ?? d.newsletterId, porCategoria: {} };
      porNl.set(d.newsletterId, l);
    }
    (l.porCategoria[d.categoria] ??= []).push(d);
  }
  return {
    de,
    ate,
    importacoes: ultimasImportacoes(5),
    totais,
    linhas: [...porNl.values()].sort((a, b) => `${a.marca}${a.nome}`.localeCompare(`${b.marca}${b.nome}`, "pt")),
  };
}
