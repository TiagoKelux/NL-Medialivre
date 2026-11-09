"use client";

import Link from "next/link";
import { useState } from "react";
import type { Comparacao } from "../lib/importar-controlo.ts";
import type { Categoria, Diferenca } from "../lib/controlo-cliente.ts";
import { DESIGNACOES, type CodigoEstado } from "../lib/tipos.ts";

/**
 * Página "Controlo do cliente": carregar o Excel que a equipa preenche à mão
 * e ver o cruzamento com a nossa caixa. O ficheiro só se lê.
 */

const CATEGORIAS: { chave: Categoria; titulo: string; explica: string }[] = [
  {
    chave: "confirmada-pelo-cliente",
    titulo: "Saiu, confirmado pelo cliente",
    explica: "Não chegou à nossa caixa, mas o cliente recebeu. O painel mostra o código dele, com um C.",
  },
  {
    chave: "nao-saiu-confirmado",
    titulo: "Não Saiu, confirmado pelas duas caixas",
    explica: "Nem a nossa caixa nem a do cliente a receberam.",
  },
  {
    chave: "desativada-pelo-cliente",
    titulo: "Desativada segundo o cliente",
    explica: "Sem email; o cliente marca 6 nesse dia.",
  },
  {
    chave: "codigo-diferente",
    titulo: "Código diferente (com email na nossa caixa)",
    explica: "Vale o que o monitor mediu; o cliente escreveu outra coisa. Rever estes casos.",
  },
  {
    chave: "cliente-nao-recebeu",
    titulo: "Chegou à nossa caixa, o cliente marca Não Saiu",
    explica: "Temos o email; a caixa do cliente pode não o ter recebido, ou foi engano no Excel.",
  },
];

const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const nomeCodigo = (v: number) => (v === 7 ? "Saiu Errada" : DESIGNACOES[v as CodigoEstado] ?? String(v));

function Dias({ lista, comCodigos }: { lista: Diferenca[]; comCodigos: boolean }) {
  return (
    <span className="controlo-dias">
      {lista.map((d) => (
        <span key={d.data} title={`Cliente: ${nomeCodigo(d.cliente)} · Monitor: ${DESIGNACOES[d.monitor]}`}>
          {diaMes(d.data)}
          {comCodigos ? ` (${d.cliente}/${d.monitor})` : ""}
        </span>
      ))}
    </span>
  );
}

export default function Controlo({ dados }: { dados: Comparacao }) {
  const [estado, setEstado] = useState<{ aEnviar: boolean; mensagem: string | null; ok: boolean }>({
    aEnviar: false,
    mensagem: null,
    ok: true,
  });

  async function enviar(ficheiro: File) {
    setEstado({ aEnviar: true, mensagem: null, ok: true });
    try {
      const r = await fetch("/api/controlo", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-ficheiro": encodeURIComponent(ficheiro.name) },
        body: await ficheiro.arrayBuffer(),
      });
      const corpo = (await r.json()) as { ok: boolean; mensagem: string };
      setEstado({ aEnviar: false, mensagem: corpo.mensagem, ok: corpo.ok });
      if (corpo.ok) setTimeout(() => window.location.reload(), 1200);
    } catch {
      setEstado({ aEnviar: false, mensagem: "Falhou o envio. Tente outra vez.", ok: false });
    }
  }

  const ultima = dados.importacoes[0];
  let resumoUltima: { folhas: { nome: string; de: string | null; ate: string | null; marcas: number; erro?: string }[]; ignoradas: { folha: string; linha: number; texto: string; motivo: string }[] } | null = null;
  try {
    resumoUltima = ultima ? JSON.parse(ultima.resumo) : null;
  } catch {
    resumoUltima = null;
  }

  return (
    <div className="envolucro controlo">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>
          <Link href="/">‹ Voltar ao monitor</Link>
        </p>
      </header>

      <p className="explica">
        O Excel de controlo que a equipa preenche à mão («Newsletters Horários») é a segunda caixa. Quando uma edição
        não chega à caixa do monitor mas o cliente a marcou como saída, conta como saída — com um <strong>C</strong> no
        painel. Quando também não chegou à do cliente, o «Não Saiu» fica provado. Quando o monitor tem o email, vale o
        que ele mediu. O ficheiro só é lido, nunca alterado.
      </p>

      <section className="cartao controlo-envio">
        <h2>Carregar o Excel</h2>
        <p>
          No SharePoint: Ficheiro › Guardar como › Transferir uma cópia. Depois escolha o ficheiro aqui. Pode carregar
          sempre que quiser: a versão mais recente substitui as marcas anteriores.
        </p>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={estado.aEnviar}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void enviar(f);
          }}
        />
        {estado.aEnviar && <p>A ler e a cruzar…</p>}
        {estado.mensagem && <p className={estado.ok ? "ok" : "erro"}>{estado.mensagem}</p>}
        {ultima ? (
          <p className="controlo-ultima">
            Última importação: {quando(ultima.importado_em)} · {ultima.ficheiro}
            {ultima.quem ? ` · ${ultima.quem}` : ""} · {ultima.marcas} marcas ({ultima.alteradas} novas ou mudadas)
          </p>
        ) : (
          <p className="controlo-ultima">Ainda nenhuma importação.</p>
        )}
        {resumoUltima && (
          <details>
            <summary>Folhas lidas e linhas ignoradas</summary>
            <ul className="lista-simples">
              {resumoUltima.folhas.map((f) => (
                <li key={f.nome}>
                  {f.nome}: {f.erro ? `não lida — ${f.erro}` : `${f.marcas} marcas, de ${f.de ? diaMes(f.de) : "—"} a ${f.ate ? diaMes(f.ate) : "—"}`}
                </li>
              ))}
              {resumoUltima.ignoradas.map((i) => (
                <li key={`${i.folha}-${i.linha}`}>
                  {i.folha}, linha {i.linha} ({i.texto}): {i.motivo}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <h2>
        Cruzamento de {diaMes(dados.de)} a {diaMes(dados.ate)}
      </h2>
      <div className="controlo-totais">
        {CATEGORIAS.map((c) => (
          <span key={c.chave} className={`pastilha ${c.chave}`} title={c.explica}>
            {c.titulo}: <strong>{dados.totais[c.chave]}</strong>
          </span>
        ))}
        <span className="pastilha igual">Iguais: <strong>{dados.totais.igual}</strong></span>
      </div>

      {dados.linhas.length === 0 ? (
        <p className="vazio">Sem diferenças no período.</p>
      ) : (
        <div className="cartao rolagem">
          <table className="tabela-controlo">
            <thead>
              <tr>
                <th>Newsletter</th>
                {CATEGORIAS.map((c) => (
                  <th key={c.chave} title={c.explica}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.newsletterId}>
                  <td>
                    {l.marca} · {l.nome}
                  </td>
                  {CATEGORIAS.map((c) => {
                    const lista = l.porCategoria[c.chave] ?? [];
                    return (
                      <td key={c.chave}>
                        {lista.length ? (
                          <>
                            <strong>{lista.length}</strong>{" "}
                            <Dias lista={lista} comCodigos={c.chave === "codigo-diferente"} />
                          </>
                        ) : (
                          ""
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="controlo-nota">Em «código diferente», entre parênteses: (cliente/monitor).</p>
        </div>
      )}
    </div>
  );
}
