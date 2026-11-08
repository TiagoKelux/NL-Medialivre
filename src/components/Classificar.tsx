"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

/**
 * A página "Por classificar": a equipa ensina o monitor a reconhecer uma
 * newsletter, ou diz que um email não é newsletter, sem mexer em código.
 * Toda a validação está no servidor (lib/regras.ts); aqui só se pergunta e
 * se mostra a resposta.
 */

export interface OpcaoNewsletter {
  id: string;
  marca: string;
  nome: string;
  ativa: boolean;
}

interface EmailSolto {
  id: number;
  nome: string;
  endereco: string;
  assunto: string;
  quando: string;
  marcas: { valor: string; rotulo: string }[];
  sugestao: string | null;
}

interface EstadoLinha {
  id: string;
  marca: string;
  nome: string;
  paga: boolean;
  configurada: boolean;
  origem: "ficheiro" | "painel" | "ambos" | null;
  ultima: string | null;
}

interface RegraLinha {
  id: number;
  newsletter: string;
  remetente: string;
  marca: string;
  marcaCompleta: string;
}

interface ExclusaoLinha {
  id: number;
  tipo: "assunto" | "mensagem";
  rotulo: string;
  quando: string;
}

interface AlteracaoLinha {
  id: number;
  quando: string;
  quem: string | null;
  acao: string;
  detalhe: string;
}

interface Props {
  dias: number;
  emails: EmailSolto[];
  opcoes: OpcaoNewsletter[];
  estado: EstadoLinha[];
  regras: RegraLinha[];
  exclusoes: ExclusaoLinha[];
  alteracoes: AlteracaoLinha[];
}

interface Aviso {
  ok: boolean;
  mensagem: string;
}

async function pedir(corpo: Record<string, unknown>): Promise<Aviso> {
  try {
    const r = await fetch("/api/classificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const dados = (await r.json()) as Partial<Aviso>;
    return { ok: r.ok && dados.ok === true, mensagem: dados.mensagem ?? "Sem resposta do servidor." };
  } catch {
    return { ok: false, mensagem: "Sem ligação ao servidor. Nada foi alterado." };
  }
}

function rotuloOpcao(o: OpcaoNewsletter | undefined): string {
  return o ? `${o.marca} · ${o.nome}` : "";
}

function CartaoEmail({
  email,
  opcoes,
  ocupado,
  agir,
}: {
  email: EmailSolto;
  opcoes: OpcaoNewsletter[];
  ocupado: boolean;
  agir: (corpo: Record<string, unknown>, confirmacao?: string) => void;
}) {
  const [newsletter, setNewsletter] = useState(email.sugestao ?? "");
  const [marca, setMarca] = useState(email.marcas[0]?.valor ?? "");
  const temMarca = email.marcas.length > 0;
  const escolhida = opcoes.find((o) => o.id === newsletter);

  // Agrupadas por marca, as ativas primeiro (a ordem vem do servidor).
  const grupos = useMemo(() => {
    const m = new Map<string, OpcaoNewsletter[]>();
    for (const o of opcoes) m.set(o.marca, [...(m.get(o.marca) ?? []), o]);
    return [...m.entries()];
  }, [opcoes]);

  return (
    <li className="email-solto">
      <div className="linha-de">
        <span className="quando">{email.quando}</span>
        <strong>{email.nome || email.endereco}</strong>
        <span className="endereco">{email.endereco}</span>
        <a className="ver" href={`/api/email?id=${email.id}`} target="_blank" rel="noopener noreferrer">
          Ver email
        </a>
      </div>
      <div className="assunto">{email.assunto || <span className="vazio">(sem assunto)</span>}</div>

      {temMarca ? (
        <div className="marcas">
          <span className="rotulo-pequeno">Marca no email</span>
          {email.marcas.length === 1 ? (
            <code className="marca-chip" title={email.marcas[0].valor}>
              {email.marcas[0].rotulo}
            </code>
          ) : (
            email.marcas.map((m) => (
              <label key={m.valor} className="marca-chip escolha" title={m.valor}>
                <input
                  type="radio"
                  name={`marca-${email.id}`}
                  checked={marca === m.valor}
                  onChange={() => setMarca(m.valor)}
                />
                <code>{m.rotulo}</code>
              </label>
            ))
          )}
        </div>
      ) : (
        <p className="sem-marca">
          Sem bloco de publicidade de newsletter: não dá para o reconhecer com segurança. Se for
          mesmo uma newsletter, peça ajuda ao suporte.
        </p>
      )}

      <div className="acoes">
        {temMarca && (
          <span className="atribuir">
            <select
              value={newsletter}
              onChange={(e) => setNewsletter(e.target.value)}
              aria-label="Newsletter"
              disabled={ocupado}
            >
              <option value="">Escolher newsletter…</option>
              {grupos.map(([grupo, lista]) => (
                <optgroup key={grupo} label={grupo}>
                  {lista.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome}
                      {o.ativa ? "" : " (desativada)"}
                      {o.id === email.sugestao ? " — sugerida" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className="botao principal"
              disabled={ocupado || !newsletter || !marca}
              onClick={() =>
                agir(
                  { acao: "atribuir", emailId: email.id, newsletterId: newsletter, marca },
                  `Atribuir a ${rotuloOpcao(escolhida)}?\n\nOs emails de ${email.endereco} com esta marca passam a contar como edições de ${rotuloOpcao(escolhida)}.`,
                )
              }
            >
              Atribuir
            </button>
          </span>
        )}
        <span className="ignorar">
          <span className="rotulo-pequeno">Não é newsletter:</span>
          <button
            type="button"
            className="botao"
            disabled={ocupado || !email.assunto.trim()}
            title="Os emails com este mesmo assunto deixam de aparecer aqui"
            onClick={() => agir({ acao: "excluir", emailId: email.id, tipo: "assunto" })}
          >
            Ignorar este assunto
          </button>
          <button
            type="button"
            className="botao"
            disabled={ocupado}
            title="Só este email deixa de aparecer aqui"
            onClick={() => agir({ acao: "excluir", emailId: email.id, tipo: "mensagem" })}
          >
            Ignorar só este
          </button>
        </span>
      </div>
    </li>
  );
}

export default function Classificar({ dias, emails, opcoes, estado, regras, exclusoes, alteracoes }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendente, iniciar] = useTransition();
  const [aEnviar, setAEnviar] = useState(false);
  const ocupado = pendente || aEnviar;

  async function agir(corpo: Record<string, unknown>, confirmacao?: string) {
    if (confirmacao && !window.confirm(confirmacao)) return;
    setAEnviar(true);
    setAviso(null);
    const r = await pedir(corpo);
    setAEnviar(false);
    setAviso(r);
    if (r.ok) iniciar(() => router.refresh());
  }

  // Por configurar primeiro.
  const estadoOrdenado = useMemo(
    () => [...estado].sort((a, b) => Number(a.configurada) - Number(b.configurada)),
    [estado],
  );
  const porConfigurar = estado.filter((s) => !s.configurada).length;
  const nuncaChegou = estado.filter((s) => s.configurada && !s.ultima).length;

  return (
    <div className="envolucro classificar">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>
          <Link href="/">‹ Voltar ao monitor</Link>
        </p>
      </header>

      {aviso && (
        <p className={`aviso ${aviso.ok ? "bom" : "mau"}`} role={aviso.ok ? "status" : "alert"}>
          {aviso.mensagem}
          <button type="button" className="fechar" onClick={() => setAviso(null)}>
            fechar
          </button>
        </p>
      )}

      <section>
        <h2>Por classificar · {emails.length}</h2>
        <p className="explica">
          Emails dos últimos {dias} dias que não contaram para nenhuma newsletter. Se for uma
          newsletter, escolha qual e carregue em <strong>Atribuir</strong>: o monitor passa a
          reconhecê-la pelo remetente e pela marca no email. Se não for, ignore-o.
        </p>
        {emails.length === 0 ? (
          <div className="cartao vazio-cartao">Nada por classificar.</div>
        ) : (
          <ul className="lista-soltos">
            {emails.map((e) => (
              <CartaoEmail key={e.id} email={e} opcoes={opcoes} ocupado={ocupado} agir={agir} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Newsletters ativas · {estado.length}</h2>
        <p className="explica">
          {porConfigurar === 0
            ? "Todas as gratuitas são reconhecidas."
            : `${porConfigurar} por configurar: o monitor ainda não as reconhece, por isso não estão a ser vigiadas.`}
          {nuncaChegou > 0 &&
            ` ${nuncaChegou} ${nuncaChegou === 1 ? "está configurada mas nunca chegou" : "estão configuradas mas nunca chegaram"} à caixa.`}
        </p>
        <div className="cartao rolagem">
          <table className="tabela-estado">
            <thead>
              <tr>
                <th>Newsletter</th>
                <th>Reconhecimento</th>
                <th>Última edição</th>
              </tr>
            </thead>
            <tbody>
              {estadoOrdenado.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="titulo">
                      {s.paga && (
                        <span className="estrela" aria-label="paga / premium">
                          ★
                        </span>
                      )}
                      <span className="marca">{s.marca}</span>
                      <span className="nome">{s.nome}</span>
                    </div>
                  </td>
                  <td>
                    {s.configurada ? (
                      <span className="pastilha bom">
                        Configurada{s.origem === "painel" ? " no painel" : s.origem === "ambos" ? " + painel" : ""}
                      </span>
                    ) : (
                      <span className="pastilha mau">Por configurar</span>
                    )}
                  </td>
                  <td className="numerico">
                    {s.ultima ?? <span className="vazio">Nunca chegou</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Regras guardadas no painel · {regras.length}</h2>
        {regras.length === 0 ? (
          <p className="explica">Nenhuma. As newsletters reconhecem-se só pela configuração de base.</p>
        ) : (
          <ul className="lista-simples cartao">
            {regras.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.newsletter}</strong> ← {r.remetente} ·{" "}
                  <code title={r.marcaCompleta}>{r.marca}</code>
                </span>
                <button
                  type="button"
                  className="botao"
                  disabled={ocupado}
                  onClick={() =>
                    agir(
                      { acao: "remover-regra", id: r.id },
                      `Remover esta regra de ${r.newsletter}?\n\nOs emails que só ela reconhecia deixam de contar.`,
                    )
                  }
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {exclusoes.length > 0 && (
        <section>
          <h2>Ignorados · {exclusoes.length}</h2>
          <ul className="lista-simples cartao">
            {exclusoes.map((x) => (
              <li key={x.id}>
                <span>
                  <span className="quando">{x.quando}</span>{" "}
                  {x.tipo === "assunto" ? (
                    <>
                      Assunto <strong>«{x.rotulo}»</strong>
                    </>
                  ) : (
                    <>Email {x.rotulo}</>
                  )}
                </span>
                <button
                  type="button"
                  className="botao"
                  disabled={ocupado}
                  onClick={() => agir({ acao: "remover-exclusao", id: x.id })}
                >
                  Voltar a mostrar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Últimas alterações</h2>
        {alteracoes.length === 0 ? (
          <p className="explica">Ainda nenhuma.</p>
        ) : (
          <ul className="lista-simples cartao historico">
            {alteracoes.map((a) => (
              <li key={a.id}>
                <span>
                  <span className="quando">{a.quando}</span>{" "}
                  {a.quem && <span className="quem">{a.quem}</span>} <strong>{a.acao}</strong> —{" "}
                  {a.detalhe}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
