"use client";

import { useMemo, useState } from "react";
import { DESIGNACOES, type CodigoEstado, type Periodicidade } from "../lib/tipos.ts";

/**
 * A página (§8): grelha do dia em cima, matriz de 30 dias em baixo, e o campo
 * `detalhe` ao clicar. Recebe tudo já formatado do servidor — não faz contas
 * nem conhece fusos.
 */

/** O que basta para saber a que filtros uma newsletter pertence. */
interface Cadencia {
  periodicidade: Periodicidade;
  diasSemana: number[] | null;
}

export interface LinhaDia extends Cadencia {
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

export interface LinhaMatriz extends Cadencia {
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

const TODAS = "todas";

const NOMES_DIAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sábado", "Domingo"];

/**
 * As chaves de filtro a que uma newsletter pertence.
 *
 * Uma semanal com mais do que um dia pertence ao filtro de cada um deles — é o
 * que se espera de quem clica em "5ª" à procura do que sai à quinta.
 */
function chavesDe(c: Cadencia): string[] {
  switch (c.periodicidade) {
    case "diaria":
      return ["diaria"];
    case "dias_uteis":
      return ["dias_uteis"];
    case "dia_semana":
      return (c.diasSemana ?? []).map((d) => `dia:${d}`);
  }
}

function rotuloDe(chave: string): string {
  if (chave === "diaria") return "Todos os dias";
  if (chave === "dias_uteis") return "2ª a 6ª";
  const d = Number(chave.slice(4));
  return NOMES_DIAS[d - 1] ?? chave;
}

/** Ordem de apresentação: diárias, dias úteis, depois 2ª → domingo. */
function peso(chave: string): number {
  if (chave === "diaria") return 0;
  if (chave === "dias_uteis") return 1;
  return 1 + Number(chave.slice(4));
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
  const [filtro, setFiltro] = useState<string>(TODAS);

  // Os filtros nascem das newsletters que existem: quando forem 62 em vez de 3,
  // aparecem sozinhos sem ninguém tocar aqui.
  const filtros = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const l of linhas) {
      for (const chave of chavesDe(l)) {
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      }
    }
    const ordenados = [...contagem.entries()].sort((a, b) => peso(a[0]) - peso(b[0]));
    return [
      { chave: TODAS, rotulo: "Todas", n: linhas.length },
      ...ordenados.map(([chave, n]) => ({ chave, rotulo: rotuloDe(chave), n })),
    ];
  }, [linhas]);

  const passa = (c: Cadencia) => filtro === TODAS || chavesDe(c).includes(filtro);

  const grelhaVisivel = grelha.filter(passa);
  const linhasVisiveis = linhas.filter(passa);

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

      <nav className="filtros" aria-label="Filtrar por periodicidade">
        {filtros.map((f) => (
          <button
            key={f.chave}
            type="button"
            className={`filtro ${filtro === f.chave ? "escolhido" : ""}`}
            aria-pressed={filtro === f.chave}
            onClick={() => setFiltro(f.chave)}
          >
            {f.rotulo}
            <span className="conta">{f.n}</span>
          </button>
        ))}
      </nav>

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
              {grelhaVisivel.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio">
                    Nenhuma newsletter neste filtro.
                  </td>
                </tr>
              )}
              {grelhaVisivel.map((l) => {
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
              {linhasVisiveis.length === 0 && (
                <tr>
                  <td className="rotulo vazio">Nenhuma newsletter neste filtro.</td>
                  {dias.map((d) => (
                    <td key={d.data} />
                  ))}
                </tr>
              )}
              {linhasVisiveis.map((l) => (
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
