"use client";

import Link from "next/link";
import { useState } from "react";
import type { Aviso, Proposta } from "../lib/avisos.ts";
import type { Pausa } from "../lib/pausas.ts";

/**
 * Página "Avisos e pausas": os emails de aviso do cliente, o que a IA propôs
 * a partir deles (quando há chave) e as pausas em vigor. Nada se aplica
 * sozinho: cada proposta aplica-se ou rejeita-se aqui, e uma pausa também se
 * cria à mão.
 */

interface Opcao {
  id: string;
  rotulo: string;
}

const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const intervalo = (de: string, ate: string) => (de === ate ? diaMes(de) : `${diaMes(de)} a ${diaMes(ate)}`);
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const ESTADO_AVISO: Record<Aviso["estado"], string> = {
  pendente: "À espera de leitura",
  "sem-ia": "Para tratar à mão",
  proposto: "Com propostas",
  erro: "Erro na leitura",
  tratado: "Tratado",
};

const ESTADO_PROPOSTA: Record<Proposta["estado"], string> = {
  "por-decidir": "Por decidir",
  aplicada: "Aplicada",
  rejeitada: "Rejeitada",
  invalida: "Inválida",
};

async function enviar(corpo: Record<string, unknown>): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const r = await fetch("/api/avisos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    return (await r.json()) as { ok: boolean; mensagem: string };
  } catch {
    return { ok: false, mensagem: "Falhou o pedido. Tente outra vez." };
  }
}

export default function Avisos({
  avisos,
  pausas,
  newsletters,
  remetentes,
  ia,
  hoje,
}: {
  avisos: Aviso[];
  pausas: Pausa[];
  newsletters: Opcao[];
  remetentes: string[];
  ia: string | null;
  hoje: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nova, setNova] = useState({ newsletterId: "", de: hoje, ate: hoje, motivo: "" });
  const rotulo = new Map(newsletters.map((n) => [n.id, n.rotulo]));
  const nome = (id: string) => rotulo.get(id) ?? id;

  async function agir(corpo: Record<string, unknown>) {
    setOcupado(true);
    const r = await enviar(corpo);
    setMsg(r);
    setOcupado(false);
    if (r.ok) setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className="envolucro controlo avisos">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>
          <Link href="/">‹ Voltar ao monitor</Link>
        </p>
      </header>

      <p className="explica">
        Uma <strong>pausa</strong> diz que uma newsletter não sai nesses dias (feriado, Natal, férias da redação). Sem
        email nesses dias o painel mostra «não prevista», nunca «Não Saiu»; se o email chegar na mesma, conta como
        saída. As pausas criam-se aqui à mão ou a partir de um <strong>aviso</strong>: um email para a caixa do monitor
        enviado por um endereço autorizado. Nada se aplica sozinho.
      </p>

      <section className="cartao controlo-envio">
        <h2>Como está configurado</h2>
        <p>
          Endereços autorizados a mandar avisos:{" "}
          {remetentes.length > 0 ? <strong>{remetentes.join(", ")}</strong> : <strong>nenhum (avisos por email desligados)</strong>}
          .
        </p>
        <p>
          Leitura automática com IA:{" "}
          {ia ? (
            <strong>ligada ({ia}). Propõe pausas a partir do texto; alguém aplica ou rejeita cada uma.</strong>
          ) : (
            <strong>desligada (sem chave). Os avisos aparecem aqui com o texto, para criar a pausa à mão.</strong>
          )}
        </p>
      </section>

      {msg && <p className={`aviso ${msg.ok ? "bom" : "mau"}`}>{msg.mensagem}</p>}

      <section className="cartao controlo-envio">
        <h2>Nova pausa</h2>
        <div className="avisos-form">
          <label>
            Newsletter
            <select value={nova.newsletterId} onChange={(e) => setNova({ ...nova, newsletterId: e.target.value })}>
              <option value="">Escolher…</option>
              {newsletters.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input
              type="date"
              value={nova.de}
              onChange={(e) => setNova({ ...nova, de: e.target.value, ate: nova.ate < e.target.value ? e.target.value : nova.ate })}
            />
          </label>
          <label>
            Até
            <input type="date" value={nova.ate} min={nova.de} onChange={(e) => setNova({ ...nova, ate: e.target.value })} />
          </label>
          <label className="largo">
            Motivo
            <input
              type="text"
              maxLength={200}
              placeholder="Ex.: Feriado 8 de dezembro"
              value={nova.motivo}
              onChange={(e) => setNova({ ...nova, motivo: e.target.value })}
            />
          </label>
          <button
            className="botao principal"
            disabled={ocupado || !nova.newsletterId || !nova.de || !nova.motivo.trim()}
            onClick={() => void agir({ acao: "criar-pausa", ...nova })}
          >
            Registar pausa
          </button>
        </div>
      </section>

      <h2>Avisos recebidos</h2>
      {avisos.length === 0 ? (
        <p className="vazio">
          Ainda nenhum aviso. {remetentes.length === 0 && "Defina AVISOS_REMETENTES no servidor para os receber."}
        </p>
      ) : (
        avisos.map((a) => (
          <section key={a.id} className={`cartao aviso-email estado-${a.estado}`}>
            <div className="aviso-cabeca">
              <strong>{a.assunto || "(sem assunto)"}</strong>
              <span className="pastilha">{ESTADO_AVISO[a.estado]}</span>
            </div>
            <p className="controlo-ultima">
              {a.remetente} · {quando(a.recebidoEm)}
              {a.modelo && a.interpretadoEm ? ` · lido por ${a.modelo} a ${quando(a.interpretadoEm)}` : ""}
              {a.tratadoEm ? ` · tratado a ${quando(a.tratadoEm)}${a.tratadoPor ? ` por ${a.tratadoPor}` : ""}` : ""}
            </p>
            {a.resumo && <p>{a.resumo}</p>}
            {a.erro && <p className="erro">{a.erro}</p>}

            {a.propostas.length > 0 && (
              <ul className="lista-simples aviso-propostas">
                {a.propostas.map((p, i) => (
                  <li key={i} className={`proposta ${p.estado}`}>
                    <div>
                      <strong>{nome(p.newsletterId)}</strong> não sai {intervalo(p.de, p.ate)} — {p.motivo}{" "}
                      <span className="pastilha">{ESTADO_PROPOSTA[p.estado]}</span>
                    </div>
                    {p.citacao && <blockquote>«{p.citacao}»</blockquote>}
                    {p.erro && <p className="erro">{p.erro}</p>}
                    {p.estado === "por-decidir" && (
                      <div className="acoes">
                        <button className="botao principal" disabled={ocupado} onClick={() => void agir({ acao: "aplicar", avisoId: a.id, indice: i })}>
                          Aplicar pausa
                        </button>
                        <button className="botao" disabled={ocupado} onClick={() => void agir({ acao: "rejeitar", avisoId: a.id, indice: i })}>
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {a.estado === "proposto" && a.propostas.length === 0 && <p className="vazio">A IA não encontrou pausas neste email.</p>}
            {a.outros.length > 0 && (
              <>
                <p className="controlo-ultima">Outras coisas no email (não se aplicam sozinhas):</p>
                <ul className="lista-simples">
                  {a.outros.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </>
            )}
            <details open={a.estado === "sem-ia"}>
              <summary>Texto do email</summary>
              <pre className="aviso-texto">{a.texto || "(vazio)"}</pre>
            </details>
            {a.estado !== "tratado" && (
              <div className="acoes">
                {ia && (
                  <button className="botao" disabled={ocupado} onClick={() => void agir({ acao: "reinterpretar", avisoId: a.id })}>
                    Ler outra vez com IA
                  </button>
                )}
                <button className="botao" disabled={ocupado} onClick={() => void agir({ acao: "arquivar", avisoId: a.id })}>
                  Dar por tratado
                </button>
              </div>
            )}
          </section>
        ))
      )}

      <h2>Pausas</h2>
      {pausas.length === 0 ? (
        <p className="vazio">Nenhuma pausa registada.</p>
      ) : (
        <div className="cartao rolagem">
          <table className="tabela-controlo">
            <thead>
              <tr>
                <th>Newsletter</th>
                <th>Dias</th>
                <th>Motivo</th>
                <th>Origem</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pausas.map((p) => (
                <tr key={p.id} className={p.anulada_em ? "anulada" : ""}>
                  <td>{nome(p.newsletter_id)}</td>
                  <td>{intervalo(p.de, p.ate)}</td>
                  <td>{p.motivo}</td>
                  <td>
                    {p.origem === "aviso" ? `Aviso #${p.aviso_id}` : "Painel"}
                    {p.criada_por ? ` · ${p.criada_por}` : ""} · {quando(p.criada_em)}
                  </td>
                  <td>{p.anulada_em ? `Anulada ${quando(p.anulada_em)}${p.anulada_por ? ` (${p.anulada_por})` : ""}` : "Em vigor"}</td>
                  <td>
                    {!p.anulada_em && (
                      <button className="botao" disabled={ocupado} onClick={() => void agir({ acao: "anular-pausa", id: p.id })}>
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
