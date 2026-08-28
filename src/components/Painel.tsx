"use client";

import { useMemo, useState } from "react";
import { DESIGNACOES, type CodigoEstado, type Periodicidade } from "../lib/tipos.ts";

/**
 * A página (§8): um único quadro, com três níveis de zoom.
 *
 *   Diária   — só hoje, com as horas e a designação por extenso
 *   Semanal  — 6 semanas, agrupadas de 2ª a 6ª
 *   Mensal   — 3 meses, agrupados por mês
 *
 * Recebe tudo já formatado do servidor — não faz contas nem conhece fusos.
 * As três vistas são fatias do mesmo intervalo, para trocar não custar uma
 * ida ao servidor.
 */

type Vista = "diaria" | "semanal" | "mensal";

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
  abreviatura: string;
  fimDeSemana: boolean;
  semana: string;
  mes: string;
  mesRotulo: string;
  hoje: boolean;
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
  inicioSemanal: string;
  nrSemanas: number;
  nrMeses: number;
}

interface Selecao {
  titulo: string;
  detalhe: string;
}

const TODAS = "todas";

const NOMES_DIAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sábado", "Domingo"];

function chavesDe(c: Cadencia): string[] {
  switch (c.periodicidade) {
    case "diaria":
      return ["diaria"];
    case "dias_uteis":
      return ["dias_uteis"];
    case "dia_semana":
      return (c.diasSemana ?? []).map((d) => `dia:${d}`);
    case "dia_mes":
      return ["dia_mes"];
    case "nao_agendada":
      return ["nao_agendada"];
  }
}

function rotuloDe(chave: string): string {
  if (chave === "diaria") return "Todos os dias";
  if (chave === "dias_uteis") return "2ª a 6ª";
  if (chave === "dia_mes") return "Dia do mês";
  if (chave === "nao_agendada") return "Sem agenda";
  return NOMES_DIAS[Number(chave.slice(4)) - 1] ?? chave;
}

/** Ordem: diárias, dias úteis, 2ª → domingo, depois as que não têm agenda. */
function peso(chave: string): number {
  if (chave === "diaria") return 0;
  if (chave === "dias_uteis") return 1;
  if (chave === "dia_mes") return 10;
  if (chave === "nao_agendada") return 11;
  return 1 + Number(chave.slice(4));
}

function Titulo({ marca, nome }: { marca: string; nome: string }) {
  return (
    <div className="titulo" title={`${marca} · ${nome}`}>
      <span className="marca">{marca}</span>
      <span className="nome">{nome}</span>
    </div>
  );
}

function Estado({ codigo }: { codigo: CodigoEstado }) {
  return (
    <span className={`estado cod-${codigo}`}>
      <span className="digito">{codigo}</span>
      <span>{DESIGNACOES[codigo]}</span>
    </span>
  );
}

export default function Painel({
  hoje,
  porConfigurar,
  grelha,
  dias,
  linhas,
  inicioSemanal,
  nrSemanas,
  nrMeses,
}: Props) {
  const [vista, setVista] = useState<Vista>("diaria");
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>(TODAS);
  // Escondidas por omissão: com 62 linhas, o que importa ao relance é o estado.
  const [mostrarHoras, setMostrarHoras] = useState(false);
  // A semana de trabalho são 5 dias. Sábado e domingo entram a pedido.
  const [comFimDeSemana, setComFimDeSemana] = useState(false);

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

  /**
   * As colunas visíveis, já agrupadas. Guarda-se o índice original de cada dia
   * porque as células das linhas continuam na ordem do intervalo completo.
   */
  const grupos = useMemo(() => {
    if (vista === "diaria") return [];
    const blocos: { chave: string; rotulo: string; colunas: { dia: DiaMatriz; i: number }[] }[] = [];

    dias.forEach((dia, i) => {
      if (dia.fimDeSemana && !comFimDeSemana) return;
      if (vista === "semanal" && dia.data < inicioSemanal) return;

      const chave = vista === "semanal" ? dia.semana : dia.mes;
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.chave === chave) ultimo.colunas.push({ dia, i });
      else blocos.push({ chave, rotulo: dia.mesRotulo, colunas: [{ dia, i }] });
    });

    // A etiqueta da semana é o intervalo; a do mês é o nome.
    return blocos.map((b) =>
      vista === "semanal"
        ? {
            ...b,
            rotulo: `${b.colunas[0].dia.rotulo} – ${b.colunas[b.colunas.length - 1].dia.rotulo}`,
          }
        : b,
    );
  }, [dias, vista, comFimDeSemana, inicioSemanal]);

  const nrColunas = grupos.reduce((t, g) => t + g.colunas.length, 0);

  const passa = (c: Cadencia) => filtro === TODAS || chavesDe(c).includes(filtro);
  const grelhaVisivel = grelha.filter(passa);
  const linhasVisiveis = linhas.filter(passa);

  function escolher(chave: string, titulo: string, detalhe: string) {
    setAtiva(chave);
    setSelecao({ titulo, detalhe });
  }

  const titulos: Record<Vista, string> = {
    diaria: `Hoje · ${hoje}`,
    semanal: `Últimas ${nrSemanas} semanas · ${comFimDeSemana ? 7 : 5} dias por semana`,
    mensal: `Últimos ${nrMeses} meses`,
  };

  return (
    <div className="envolucro">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>Estado de {hoje}, lido da caixa de correio de 5 em 5 minutos.</p>
      </header>

      {porConfigurar.length > 0 && (
        <div className="aviso">
          <strong>
            {porConfigurar.length === 1
              ? "1 newsletter ainda não reconhece os seus emails"
              : `${porConfigurar.length} newsletters ainda não reconhecem os seus emails`}
          </strong>
          Os emails continuam a ser recolhidos e guardados, mas não são
          classificados até preencheres <code>remetentes</code> e{" "}
          <code>padraoAssunto</code> em <code>config/newsletters.ts</code>. Corre{" "}
          <code>npm run listar</code> para descobrir os valores reais.
          {porConfigurar.length <= 6 && ` — ${porConfigurar.join(", ")}.`}
        </div>
      )}

      <div className="linha-filtros">
        <span className="rotulo-filtros">Periodicidade</span>
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
      </div>

      <div className="linha-filtros">
        <span className="rotulo-filtros">Visão</span>
        <nav className="filtros" aria-label="Nível de detalhe">
          {(["diaria", "semanal", "mensal"] as Vista[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`filtro ${vista === v ? "escolhido" : ""}`}
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
            >
              {v === "diaria" ? "Diária" : v === "semanal" ? "Semanal" : "Mensal"}
            </button>
          ))}
        </nav>
      </div>

      <section>
        <div className="cabeca-seccao">
          <h2>{titulos[vista]}</h2>

          <div className="controlos">
            {vista === "diaria" ? (
              <button
                type="button"
                className="alternar"
                aria-expanded={mostrarHoras}
                onClick={() => setMostrarHoras((v) => !v)}
              >
                {mostrarHoras ? "Ocultar" : "Mostrar"} horas
              </button>
            ) : (
              <button
                type="button"
                className="alternar"
                aria-expanded={comFimDeSemana}
                onClick={() => setComFimDeSemana((v) => !v)}
              >
                {comFimDeSemana ? "Só dias úteis" : "Incluir fim de semana"}
              </button>
            )}
          </div>
        </div>

        <div className="cartao rolagem">
          {vista === "diaria" ? (
            <table className="grelha">
              <thead>
                <tr>
                  <th>Newsletter</th>
                  {mostrarHoras && <th>Prevista</th>}
                  {mostrarHoras && <th>Recebida</th>}
                  {mostrarHoras && <th>Atraso</th>}
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {grelhaVisivel.length === 0 && (
                  <tr>
                    <td colSpan={mostrarHoras ? 5 : 2} className="vazio">
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
                        <Titulo marca={l.marca} nome={l.nome} />
                      </td>
                      {mostrarHoras && <td className="numerico">{l.horaPrevista}</td>}
                      {mostrarHoras && (
                        <td className="numerico">
                          {l.horaRecebida ?? <span className="vazio">—</span>}
                        </td>
                      )}
                      {mostrarHoras && (
                        <td className="numerico">
                          {l.atraso ?? <span className="vazio">—</span>}
                        </td>
                      )}
                      <td>
                        <Estado codigo={l.codigo} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="matriz">
              <thead>
                <tr>
                  <th className="rotulo" rowSpan={2}>
                    Newsletter
                  </th>
                  {grupos.map((g) => (
                    <th key={g.chave} className="semana" colSpan={g.colunas.length}>
                      {g.rotulo}
                    </th>
                  ))}
                </tr>
                <tr>
                  {grupos.map((g) =>
                    g.colunas.map(({ dia }, j) => (
                      <th
                        key={dia.data}
                        className={`dia ${dia.fimDeSemana ? "fds" : ""} ${
                          j === 0 ? "inicio-grupo" : ""
                        } ${dia.hoje ? "agora" : ""}`}
                        title={dia.data}
                      >
                        <span className="abrev">{dia.abreviatura}</span>
                        <span className="numero">{dia.rotulo.slice(0, 2)}</span>
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.length === 0 && (
                  <tr>
                    <td className="rotulo vazio">Nenhuma newsletter neste filtro.</td>
                    <td colSpan={nrColunas} />
                  </tr>
                )}
                {linhasVisiveis.map((l) => (
                  <tr key={l.newsletterId}>
                    <td className="rotulo">
                      <Titulo marca={l.marca} nome={l.nome} />
                    </td>
                    {grupos.map((g) =>
                      g.colunas.map(({ dia, i }, j) => {
                        const c = l.celulas[i];
                        const chave = `${l.newsletterId}:${dia.data}`;
                        const borda = j === 0 ? "inicio-grupo" : "";
                        if (!c) {
                          return (
                            <td key={chave} className={borda}>
                              <span className="celula ausente">·</span>
                            </td>
                          );
                        }
                        return (
                          <td key={chave} className={borda}>
                            <button
                              type="button"
                              className={`celula cod-${c.codigo} ${c.fechado ? "" : "aberta"} ${
                                ativa === chave ? "ativa" : ""
                              }`}
                              title={`${dia.rotulo} — ${DESIGNACOES[c.codigo]}`}
                              onClick={() =>
                                escolher(
                                  chave,
                                  `${l.marca} · ${l.nome} — ${dia.rotulo}`,
                                  c.detalhe,
                                )
                              }
                            >
                              {c.codigo}
                            </button>
                          </td>
                        );
                      }),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selecao && (
          <div className="detalhe">
            <div className="cabeca">{selecao.titulo}</div>
            <div className="corpo">{selecao.detalhe}</div>
            <button type="button" className="fechar" onClick={() => {
              setSelecao(null);
              setAtiva(null);
            }}>
              fechar
            </button>
          </div>
        )}
      </section>

      {/* Fixa no fundo: a legenda tem de estar à mão em qualquer ponto do
          scroll, senão com 62 linhas perde-se o significado dos números. */}
      <aside className="legenda" aria-label="Legenda dos códigos">
        {([1, 2, 3, 4, 5, 6] as CodigoEstado[]).map((c) => (
          <Estado key={c} codigo={c} />
        ))}
      </aside>
    </div>
  );
}
