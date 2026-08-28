"use client";

import { useState } from "react";
import { DESIGNACOES, type CodigoEstado } from "../lib/tipos.ts";

/**
 * A página (§8): grelha do dia em cima, matriz de 30 dias em baixo, e o campo
 * `detalhe` ao clicar. Recebe tudo já formatado do servidor — não faz contas
 * nem conhece fusos.
 */

export interface LinhaDia {
  newsletterId: string;
  marca: string;
  nome: string;
  horaPrevista: string;
  horaRecebida: string | null;
  atraso: string | null;
  codigo: CodigoEstado;
  detalhe: string;
  fechado: boolean;
}

export interface DiaMatriz {
  data: string;
  rotulo: string;
  fimDeSemana: boolean;
}

export interface CelulaMatriz {
  codigo: CodigoEstado;
  detalhe: string;
  fechado: boolean;
}

export interface LinhaMatriz {
  newsletterId: string;
  marca: string;
  nome: string;
  celulas: (CelulaMatriz | null)[];
}

interface Props {
  hoje: string;
  porConfigurar: string[];
  grelha: LinhaDia[];
  dias: DiaMatriz[];
  linhas: LinhaMatriz[];
}

interface Selecao {
  titulo: string;
  detalhe: string;
}

function Estado({ codigo }: { codigo: CodigoEstado }) {
  return (
    <span className={`estado cod-${codigo}`}>
      <span className="digito">{codigo}</span>
      <span>{DESIGNACOES[codigo]}</span>
    </span>
  );
}

export default function Painel({ hoje, porConfigurar, grelha, dias, linhas }: Props) {
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [ativa, setAtiva] = useState<string | null>(null);

  function escolher(chave: string, titulo: string, detalhe: string) {
    setAtiva(chave);
    setSelecao({ titulo, detalhe });
  }

  return (
    <div className="envolucro">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>Estado de {hoje}, lido da caixa de correio de 5 em 5 minutos.</p>
      </header>

      {porConfigurar.length > 0 && (
        <div className="aviso">
          <strong>Faltam remetentes e padrão de assunto</strong>
          {porConfigurar.join(", ")} ainda não sabem reconhecer os seus emails. Os
          emails continuam a ser recolhidos e guardados, mas não são classificados
          até preencheres <code>remetentes</code> e <code>padraoAssunto</code> em{" "}
          <code>config/newsletters.ts</code>.
        </div>
      )}

      <section>
        <h2>Hoje</h2>
        <div className="cartao">
          <table className="grelha">
            <thead>
              <tr>
                <th>Newsletter</th>
                <th>Prevista</th>
                <th>Recebida</th>
                <th>Atraso</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {grelha.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio">
                    Ainda não há registos para hoje.
                  </td>
                </tr>
              )}
              {grelha.map((l) => {
                const chave = `dia:${l.newsletterId}`;
                return (
                  <tr
                    key={l.newsletterId}
                    className={`clicavel ${l.fechado ? "" : "aberta"} ${
                      ativa === chave ? "selecionada" : ""
                    }`}
                    onClick={() => escolher(chave, `${l.marca} · ${l.nome} — hoje`, l.detalhe)}
                  >
                    <td>
                      <div className="marca">{l.marca}</div>
                      <div className="nome">{l.nome}</div>
                    </td>
                    <td className="numerico">{l.horaPrevista}</td>
                    <td className="numerico">
                      {l.horaRecebida ?? <span className="vazio">—</span>}
                    </td>
                    <td className="numerico">
                      {l.atraso ?? <span className="vazio">—</span>}
                    </td>
                    <td>
                      <Estado codigo={l.codigo} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Últimos {dias.length} dias</h2>
        <div className="cartao rolagem">
          <table className="matriz">
            <thead>
              <tr>
                <th className="rotulo">Newsletter</th>
                {dias.map((d) => (
                  <th key={d.data} className={`dia ${d.fimDeSemana ? "fds" : ""}`}>
                    {d.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.newsletterId}>
                  <td className="rotulo">
                    <div className="marca">{l.marca}</div>
                    <div className="nome">{l.nome}</div>
                  </td>
                  {l.celulas.map((c, i) => {
                    const dia = dias[i];
                    const chave = `${l.newsletterId}:${dia.data}`;
                    if (!c) {
                      return (
                        <td key={chave}>
                          <span className="celula ausente">·</span>
                        </td>
                      );
                    }
                    return (
                      <td key={chave}>
                        <button
                          type="button"
                          className={`celula cod-${c.codigo} ${c.fechado ? "" : "aberta"} ${
                            ativa === chave ? "ativa" : ""
                          }`}
                          title={`${dia.rotulo} — ${DESIGNACOES[c.codigo]}`}
                          onClick={() =>
                            escolher(chave, `${l.marca} · ${l.nome} — ${dia.rotulo}`, c.detalhe)
                          }
                        >
                          {c.codigo}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selecao ? (
          <div className="detalhe">
            <div className="cabeca">{selecao.titulo}</div>
            <div className="corpo">{selecao.detalhe}</div>
          </div>
        ) : (
          <div className="legenda">
            {([1, 2, 3, 4, 5, 6] as CodigoEstado[]).map((c) => (
              <Estado key={c} codigo={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
