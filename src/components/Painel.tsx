"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { chavesDe, peso, rotuloDe, TODAS } from "../lib/filtros.ts";
import type { EstadoLeitura } from "../lib/leitura.ts";
import type { Periodo, Vista } from "../lib/periodo.ts";
import { DESIGNACOES, type CodigoEstado, type Periodicidade } from "../lib/tipos.ts";

/**
 * A página (§8): um único quadro, com três níveis de zoom.
 *
 *   Diária   — um dia, com as horas e a designação por extenso
 *   Semanal  — uma semana, de 2ª a 6ª
 *   Mensal   — um mês
 *
 * A vista e o dia que a ancora vivem no URL, para os botões de navegação
 * funcionarem e para o Excel se descarregar exatamente do que se está a ver.
 * O resto — filtro, colunas escondidas — é estado local.
 */

interface Cadencia {
  periodicidade: Periodicidade;
  diasSemana: number[] | null;
  /**
   * A newsletter ainda não reconhece os seus emails (sem remetente
   * configurado). Um "Não Saiu" nela não quer dizer nada — mostra-se a preto.
   */
  semEmail: boolean;
  /** Só para assinantes (coluna "Segmento" do Excel) — leva uma estrela. */
  paga: boolean;
}

const SEM_EMAIL = "Não assinada no email";
const AGUARDA = "A aguardar";
const POR_CONFIRMAR = "Por confirmar";

/**
 * Como se mostra um registo, para lá do código:
 * - "sem-email": a newsletter ainda não reconhece os seus emails — preto;
 * - "aguarda": registo de hoje ainda antes da hora limite. Na base de dados
 *   nasce com o código 5, mas "Não Saiu" só é verdade depois de fechar;
 * - "por-confirmar": a hora limite passou mas ainda não houve uma leitura da
 *   caixa depois dela (monitor parado, PC desligado, leitura a falhar). Sem
 *   prova, não se afirma "Não Saiu".
 * O código 6 (não é dia, desativada) mostra-se sempre como está.
 */
type Variante = "sem-email" | "aguarda" | "por-confirmar" | null;

function variante(
  semEmail: boolean,
  codigo: CodigoEstado,
  fechado: boolean,
  limitePassou: boolean,
): Variante {
  if (codigo === 6) return null;
  if (semEmail) return "sem-email";
  if (!fechado && codigo === 5) return limitePassou ? "por-confirmar" : "aguarda";
  return null;
}

const ROTULO: Record<Exclude<Variante, null>, { digito: string; texto: string }> = {
  "sem-email": { digito: "–", texto: SEM_EMAIL },
  aguarda: { digito: "…", texto: AGUARDA },
  "por-confirmar": { digito: "?", texto: POR_CONFIRMAR },
};

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
  limitePassou: boolean;
  temConteudo: boolean;
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
  limitePassou: boolean;
  temConteudo: boolean;
}

export interface EmailSolto {
  remetente: string;
  assunto: string;
  quando: string;
}

/** O que a rota /api/preview devolve para o cartão de passagem do rato. */
interface Previsualizacao {
  marca: string;
  nome: string;
  assunto: string;
  hora: string;
  artigos: { titulo: string; url: string }[];
}

interface CartaoAberto {
  chave: string;
  newsletterId: string;
  data: string;
  x: number;
  /** Distância ao topo ou ao fundo do ecrã, conforme o cartão caiba abaixo. */
  y: number;
  acima: boolean;
  altura: number;
  detalhe: string;
  dados: Previsualizacao | null;
}

/** Espaço que o cartão precisa por baixo da célula para caber sem cortar. */
const ALTURA_CARTAO = 300;
const LARGURA_CARTAO = 360;

export interface LinhaMatriz extends Cadencia {
  newsletterId: string;
  marca: string;
  nome: string;
  celulas: (CelulaMatriz | null)[];
}

interface Props {
  hoje: string;
  leitura: EstadoLeitura;
  porClassificar: EmailSolto[];
  periodo: Periodo;
  grelha: LinhaDia[];
  dias: DiaMatriz[];
  linhas: LinhaMatriz[];
}

interface Selecao {
  titulo: string;
  detalhe: string;
}

const NOMES_VISTA: Record<Vista, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

function Titulo({ marca, nome, paga }: { marca: string; nome: string; paga: boolean }) {
  return (
    <div className="titulo" title={`${marca} · ${nome}${paga ? " · paga / premium" : ""}`}>
      {paga && (
        <span className="estrela" aria-label="paga / premium">
          ★
        </span>
      )}
      <span className="marca">{marca}</span>
      <span className="nome">{nome}</span>
    </div>
  );
}

/** Acima disto sem uma leitura boa, alguma coisa parou: o ciclo é de 5 min. */
const LEITURA_ATRASADA_MIN = 15;

function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ha(minutos: number): string {
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `há ${horas} h ${minutos % 60} min`;
  return `há ${Math.floor(horas / 24)} dias`;
}

/**
 * Quando a caixa deixa de ser lida, os registos continuam a fechar como
 * "Não Saiu". Este aviso é o que permite distinguir as duas coisas. A idade
 * conta-se no browser, para avisar também quando a própria página ficou parada.
 */
function LeituraCaixa({ leitura }: { leitura: EstadoLeitura }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { ok, falha } = leitura;
  const minutos = ok ? Math.floor((agora - new Date(ok).getTime()) / 60_000) : null;

  if (falha) {
    return (
      <p className="leitura alerta" role="alert">
        <strong>A leitura da caixa está a falhar desde as {horaDe(falha.em)}</strong> ({falha.erro}).
        {ok ? ` Última leitura boa às ${horaDe(ok)}, ${ha(minutos!)}.` : ""} Os “Não Saiu” desde
        então podem ser falsos.
      </p>
    );
  }
  if (!ok) {
    return (
      <p className="leitura alerta" role="alert">
        <strong>A caixa ainda não foi lida.</strong> Os estados não refletem o que chegou.
      </p>
    );
  }
  if (minutos! > LEITURA_ATRASADA_MIN) {
    return (
      <p className="leitura alerta" role="alert">
        <strong>
          Última leitura da caixa às {horaDe(ok)}, {ha(minutos!)}.
        </strong>{" "}
        O monitor parou ou a página não foi recarregada — os estados podem não refletir o que já
        chegou.
      </p>
    );
  }
  return (
    <p className="leitura">
      Caixa lida às {horaDe(ok)} ({ha(minutos!)}) · lê de 5 em 5 minutos, a última semana.
    </p>
  );
}

function Estado({ codigo, variante = null }: { codigo: CodigoEstado; variante?: Variante }) {
  if (variante) {
    return (
      <span className={`estado ${variante}`}>
        <span className="digito">{ROTULO[variante].digito}</span>
        <span>{ROTULO[variante].texto}</span>
      </span>
    );
  }
  return (
    <span className={`estado cod-${codigo}`}>
      <span className="digito">{codigo}</span>
      <span>{DESIGNACOES[codigo]}</span>
    </span>
  );
}

export default function Painel({ hoje, leitura, porClassificar, periodo, grelha, dias, linhas }: Props) {
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>(TODAS);
  // Escondidas por omissão: com 62 linhas, o que importa ao relance é o estado.
  const [mostrarHoras, setMostrarHoras] = useState(false);
  // A semana de trabalho são 5 dias. Sábado e domingo entram a pedido.
  const [comFimDeSemana, setComFimDeSemana] = useState(false);
  const [cartao, setCartao] = useState<CartaoAberto | null>(null);

  const { vista } = periodo;

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

  /** As colunas visíveis, agrupadas por semana ou por mês. */
  const grupos = useMemo(() => {
    if (vista === "diaria") return [];
    const blocos: { chave: string; rotulo: string; colunas: { dia: DiaMatriz; i: number }[] }[] = [];

    dias.forEach((dia, i) => {
      if (dia.fimDeSemana && !comFimDeSemana) return;
      const chave = vista === "semanal" ? dia.semana : dia.mes;
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.chave === chave) ultimo.colunas.push({ dia, i });
      else blocos.push({ chave, rotulo: dia.mesRotulo, colunas: [{ dia, i }] });
    });

    return blocos.map((b) =>
      vista === "semanal"
        ? {
            ...b,
            rotulo: `${b.colunas[0].dia.rotulo} – ${b.colunas[b.colunas.length - 1].dia.rotulo}`,
          }
        : b,
    );
  }, [dias, vista, comFimDeSemana]);

  const nrColunas = grupos.reduce((t, g) => t + g.colunas.length, 0);

  /**
   * Quanto espaco cada coluna pode ocupar. Uma semana tem 5 colunas e um mes
   * tem 20 e tal: em ambos os casos sobra largura, e celulas de 24px deixavam
   * meia tabela vazia. So acima das 24 colunas e que a matriz volta a apertar
   * e a rolar na horizontal.
   */
  const densidade = nrColunas <= 8 ? "larga" : nrColunas <= 24 ? "media" : "";

  const passa = (c: Cadencia) => filtro === TODAS || chavesDe(c).includes(filtro);
  const grelhaVisivel = grelha.filter(passa);
  const linhasVisiveis = linhas.filter(passa);

  function escolher(chave: string, titulo: string, detalhe: string) {
    setAtiva(chave);
    setSelecao({ titulo, detalhe });
  }

  /**
   * Passar o rato numa célula com conteúdo abre um cartão com o resumo
   * executivo da edição; clicar abre a newsletter inteira. O resumo é pedido
   * só aqui, e guardado em cache — não vem no payload da página.
   */
  const cache = useRef(new Map<string, Previsualizacao>());
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fecho = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Onde cabe o cartão. Numa lista de 62 linhas a maioria das células está
   * na metade de baixo do ecrã: abrir sempre para baixo cortava o cartão.
   */
  function posicionar(caixa: DOMRect) {
    // A legenda está fixa no fundo e tapa os últimos ~46px.
    const espacoAbaixo = window.innerHeight - caixa.bottom - 56;
    const espacoAcima = caixa.top - 16;
    const acima = espacoAbaixo < ALTURA_CARTAO && espacoAcima > espacoAbaixo;

    const margem = LARGURA_CARTAO / 2 + 12;
    return {
      x: Math.min(Math.max(caixa.left + caixa.width / 2, margem), window.innerWidth - margem),
      y: acima ? window.innerHeight - caixa.top + 10 : caixa.bottom + 10,
      acima,
      // A altura sai do espaço que existe, não de um 60vh que ignora onde a
      // célula está: com 62 linhas, metade delas fica encostada a um extremo.
      altura: Math.max(140, Math.min(420, acima ? espacoAcima : espacoAbaixo)),
    };
  }

  function aoEntrar(
    evento: { currentTarget: HTMLElement },
    newsletterId: string,
    data: string,
    detalhe: string,
    temConteudo: boolean,
  ) {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (fecho.current) clearTimeout(fecho.current);

    const pos = posicionar(evento.currentTarget.getBoundingClientRect());
    const chave = `${newsletterId}|${data}`;
    const base = { chave, newsletterId, data, ...pos, detalhe };

    // Sem conteúdo o cartão mostra só o detalhe — não vale a pena ir à rede.
    if (!temConteudo) {
      temporizador.current = setTimeout(() => setCartao({ ...base, dados: null }), 180);
      return;
    }

    const guardado = cache.current.get(chave);
    if (guardado) {
      temporizador.current = setTimeout(() => setCartao({ ...base, dados: guardado }), 180);
      return;
    }

    temporizador.current = setTimeout(async () => {
      setCartao({ ...base, dados: null });
      try {
        const r = await fetch(
          `/api/preview?newsletter=${encodeURIComponent(newsletterId)}&data=${data}`,
        );
        const corpo = (await r.json()) as Previsualizacao & { vazio?: boolean };
        if (corpo.vazio) return;
        cache.current.set(chave, corpo);
        // Só actualiza se o rato ainda estiver na mesma célula.
        setCartao((c) => (c && c.chave === chave ? { ...c, dados: corpo } : c));
      } catch {
        /* Falhar o resumo não pode partir a página. */
      }
    }, 220);
  }

  /**
   * Fecha com atraso: sem isto, o caminho da célula até ao cartão passa por
   * fora dos dois e o cartão desaparecia a meio, tornando-o inalcançável.
   */
  function aoSair() {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (fecho.current) clearTimeout(fecho.current);
    fecho.current = setTimeout(() => setCartao(null), 160);
  }

  function segurarCartao() {
    if (fecho.current) clearTimeout(fecho.current);
  }

  const urlNewsletter = (newsletterId: string, data: string) =>
    `/api/conteudo?newsletter=${encodeURIComponent(newsletterId)}&data=${data}`;

  const ligacao = (v: Vista, ate: string) => `/?vista=${v}&ate=${ate}`;
  const urlExcel = `/api/exportar?vista=${vista}&ate=${periodo.ancora}&filtro=${filtro}`;

  return (
    <div className="envolucro">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <LeituraCaixa leitura={leitura} />
        {porClassificar.length > 0 && (
          <details className="soltos">
            <summary>
              {porClassificar.length === 1
                ? "1 email da última semana sem newsletter atribuída"
                : `${porClassificar.length} emails da última semana sem newsletter atribuída`}
            </summary>
            <p>
              Não são boas-vindas nem promoções conhecidas. Ou é uma newsletter ainda por configurar,
              ou um remetente que mudou de nome — no segundo caso, a newsletter está a aparecer como
              “Não Saiu” sem razão.
            </p>
            <ul>
              {porClassificar.map((e, i) => (
                <li key={i}>
                  <span className="quando">{e.quando}</span>{" "}
                  <strong>{e.remetente.split("<")[0].trim() || e.remetente}</strong> — {e.assunto}
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>

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
            <Link
              key={v}
              href={ligacao(v, periodo.ancora)}
              className={`filtro ${vista === v ? "escolhido" : ""}`}
              aria-current={vista === v ? "page" : undefined}
            >
              {NOMES_VISTA[v]}
            </Link>
          ))}
        </nav>
      </div>

      <section>
        <div className="cabeca-seccao">
          <div className="navegacao">
            <Link
              className="passo"
              href={ligacao(vista, periodo.anterior)}
              aria-label="Período anterior"
            >
              ‹
            </Link>
            <h2>{periodo.titulo}</h2>
            {periodo.seguinte ? (
              <Link
                className="passo"
                href={ligacao(vista, periodo.seguinte)}
                aria-label="Período seguinte"
              >
                ›
              </Link>
            ) : (
              <span className="passo inativo" aria-hidden="true">
                ›
              </span>
            )}
            {!periodo.contemHoje && (
              <Link className="alternar" href={ligacao(vista, hoje)}>
                Hoje
              </Link>
            )}
          </div>

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
            <a className="alternar descarregar" href={urlExcel} download>
              Descarregar Excel
            </a>
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
                      Sem registos para este dia neste filtro.
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
                      onMouseEnter={(e) =>
                        aoEntrar(e, l.newsletterId, periodo.de, l.detalhe, l.temConteudo)
                      }
                      onMouseLeave={aoSair}
                      onClick={() => {
                        if (l.temConteudo) {
                          window.open(urlNewsletter(l.newsletterId, periodo.de), "_blank");
                          return;
                        }
                        escolher(chave, `${l.marca} · ${l.nome} — ${periodo.titulo}`, l.detalhe);
                      }}
                    >
                      <td>
                        <Titulo marca={l.marca} nome={l.nome} paga={l.paga} />
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
                        <Estado codigo={l.codigo} variante={variante(l.semEmail, l.codigo, l.fechado, l.limitePassou)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className={`matriz ${densidade}`}>
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
                      <Titulo marca={l.marca} nome={l.nome} paga={l.paga} />
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
                        const v = variante(l.semEmail, c.codigo, c.fechado, c.limitePassou);
                        const designacao = v ? ROTULO[v].texto : DESIGNACOES[c.codigo];
                        return (
                          <td key={chave} className={borda}>
                            <button
                              type="button"
                              className={`celula ${v ?? `cod-${c.codigo}`} ${c.fechado ? "" : "aberta"} ${
                                c.temConteudo ? "com-conteudo" : ""
                              } ${ativa === chave ? "ativa" : ""}`}
                              title={
                                c.temConteudo
                                  ? `${dia.rotulo} — ${designacao} · clique para abrir a newsletter`
                                  : `${dia.rotulo} — ${designacao}`
                              }
                              onMouseEnter={(ev) =>
                                aoEntrar(ev, l.newsletterId, dia.data, c.detalhe, c.temConteudo)
                              }
                              onMouseLeave={aoSair}
                              onClick={() => {
                                if (c.temConteudo) {
                                  window.open(urlNewsletter(l.newsletterId, dia.data), "_blank");
                                  return;
                                }
                                escolher(
                                  chave,
                                  `${l.marca} · ${l.nome} — ${dia.rotulo}`,
                                  c.detalhe,
                                );
                              }}
                            >
                              {v ? ROTULO[v].digito : c.codigo}
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
            <button
              type="button"
              className="fechar"
              onClick={() => {
                setSelecao(null);
                setAtiva(null);
              }}
            >
              fechar
            </button>
          </div>
        )}
      </section>

      {/* O cartão de passagem do rato: o essencial da edição sem sair da
          matriz. Segue o cursor em coordenadas de ecrã, por isso é `fixed`. */}
      {cartao && (
        <div
          className={`cartao-resumo ${cartao.acima ? "acima" : ""}`}
          style={
            cartao.acima
              ? { left: cartao.x, bottom: cartao.y, maxHeight: cartao.altura }
              : { left: cartao.x, top: cartao.y, maxHeight: cartao.altura }
          }
          role="tooltip"
          onMouseEnter={segurarCartao}
          onMouseLeave={aoSair}
        >
          {/* Só o corpo rola; o botão fica de fora para estar sempre à vista,
              senão o acesso directo ficava escondido no fundo do scroll. */}
          <div className="corpo-resumo">
            <div className="linha-detalhe">{cartao.detalhe}</div>

            {cartao.dados ? (
              <>
                <div className="cabeca-resumo">
                  {cartao.dados.marca} · {cartao.dados.nome} · {cartao.dados.hora}
                </div>
                <div className="assunto">{cartao.dados.assunto}</div>
                {cartao.dados.artigos.length > 0 && (
                  <ul className="manchetes">
                    {cartao.dados.artigos.map((a) => (
                      <li key={a.url}>{a.titulo}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="pe-resumo">Sem newsletter guardada para este dia.</div>
            )}
          </div>

          {cartao.dados && (
            <a
              className="botao-abrir"
              href={urlNewsletter(cartao.newsletterId, cartao.data)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir newsletter
            </a>
          )}
        </div>
      )}

      {/* Fixa no fundo: a legenda tem de estar à mão em qualquer ponto do
          scroll, senão com 62 linhas perde-se o significado dos números. */}
      <aside className="legenda" aria-label="Legenda dos códigos">
        {([1, 2, 3, 4, 5, 6] as CodigoEstado[]).map((c) => (
          <Estado key={c} codigo={c} />
        ))}
        <Estado codigo={5} variante="aguarda" />
        <Estado codigo={5} variante="por-confirmar" />
        <Estado codigo={5} variante="sem-email" />
      </aside>
    </div>
  );
}
