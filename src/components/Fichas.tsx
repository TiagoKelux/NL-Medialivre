import Link from "next/link";
import type { ReactNode } from "react";
import type { Ficha } from "../lib/fichas.ts";

/**
 * As fichas das newsletters: o normal de cada uma (lib/fichas.ts) e a última
 * edição ao lado, agrupadas por marca. Só leitura, sem estado: o que aqui se
 * mostra vem todo do servidor. Sem dados, "—" — nunca um valor inventado.
 */

const SEM = "—";
const DIAS = ["2.ª", "3.ª", "4.ª", "5.ª", "6.ª", "Sá", "Do"];

function diaMes(data: string | null): string {
  if (!data) return SEM;
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

/** Igual ao texto do perfil: horas abaixo de um dia, dias com uma casa até 10. */
function idade(x: number | null | undefined): string {
  if (x === null || x === undefined) return SEM;
  return x < 1 ? `${Math.round(x * 24)} h` : `${x.toFixed(x < 10 ? 1 : 0).replace(".", ",")} dias`;
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? SEM : `${Math.round(x * 100)}%`;
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="ficha-linha">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DiasVistos({ f }: { f: Ficha }) {
  const conf = f.dias.configurados;
  return (
    <span className="ficha-dias">
      {DIAS.map((d, i) => {
        const esperado = conf === null ? null : conf.includes(i + 1);
        const n = f.dias.vistos[i];
        const classe = esperado === null ? "" : esperado ? "esperado" : n > 0 ? "fora" : "folga";
        return (
          <span key={d} className={`ficha-dia ${classe}`} title={esperado ? "dia de envio" : esperado === false ? "não é dia de envio" : ""}>
            {d} <span className="numerico">{n}</span>
          </span>
        );
      })}
    </span>
  );
}

function Veredicto({ f }: { f: Ficha }) {
  const u = f.ultimaEdicao;
  if (!u) return <span className="pastilha neutra">Sem edições</span>;
  if (u.desatualizada) return <span className="pastilha desatualizada">Conteúdo desatualizado</span>;
  if (u.igualA) return <span className="pastilha desatualizada">Igual à de {diaMes(u.igualA.data)}</span>;
  if (u.avisos.length) return <span className="pastilha atencao">{u.avisos.length === 1 ? "1 aviso" : `${u.avisos.length} avisos`}</span>;
  if (u.frescoProvado) return <span className="pastilha bom">Dentro do normal</span>;
  return <span className="pastilha neutra">Sem prova de idade</span>;
}

function CartaoFicha({ f }: { f: Ficha }) {
  const u = f.ultimaEdicao;
  const frases = u ? [u.desatualizada, u.igualA ? `Igual à edição de ${diaMes(u.igualA.data)} (${u.igualA.como === "hash" ? "mesmo conteúdo" : "mesmos artigos"}).` : null, ...u.avisos, u.idade].filter((t): t is string => !!t) : [];
  return (
    <article className="cartao ficha">
      <header className="ficha-topo">
        <div>
          <strong>{f.nome}</strong>
          {!f.ativa && <span className="vazio"> (desativada)</span>}
          <div className="ficha-calendario">{f.calendario}</div>
        </div>
        <span className={`pastilha ${f.estadoPerfil === "estável" ? "bom" : "neutra"}`} title="Estado do perfil">
          {f.estadoPerfil}
        </span>
      </header>

      <dl className="ficha-dados">
        <Linha rotulo="Edições">
          {f.edicoes ? (
            <>
              <span className="numerico">{f.edicoes}</span> ({diaMes(f.primeira)} a {diaMes(f.ultima)})
            </>
          ) : (
            SEM
          )}
        </Linha>
        <Linha rotulo="Dias">
          <DiasVistos f={f} />
          {f.dias.foraDoCalendario > 0 && (
            <div className="ficha-nota">{f.dias.foraDoCalendario} fora do calendário configurado</div>
          )}
        </Linha>
        <Linha rotulo="Hora">
          {f.hora ? (
            <span className="numerico">
              {f.hora.prevista ? `prevista ${f.hora.prevista} (até ${f.hora.limite}) · ` : ""}
              mediana {f.hora.mediana} · p90 {f.hora.p90}
              {f.hora.aTempo !== null ? ` · ${pct(f.hora.aTempo)} a tempo` : ""}
            </span>
          ) : (
            SEM
          )}
        </Linha>
        <Linha rotulo="Artigos">
          {f.artigos ? (
            <span className="numerico">
              {f.artigos.mediana} ({f.artigos.min} a {f.artigos.max})
            </span>
          ) : (
            SEM
          )}
        </Linha>
        <Linha rotulo="Mais recente">
          {f.idade ? (
            <span className="numerico">
              mediana {idade(f.idade.p50)} · p90 {idade(f.idade.p90)} · máx. {idade(f.idade.max)}
            </span>
          ) : (
            SEM
          )}
          <div className="ficha-nota">artigos com data: {pct(f.coberturaDatas)}</div>
        </Linha>
        <Linha rotulo="Reutiliza">
          <span className="numerico">{f.reusoP90 === null ? SEM : `até ${pct(f.reusoP90)} (p90)`}</span>
        </Linha>
        <Linha rotulo="Data no topo">{f.edicoes ? (f.dataNoTopo ? "sempre" : "não") : SEM}</Linha>
      </dl>

      <div className="ficha-ultima">
        <div className="ficha-ultima-cabeca">
          <span className="rotulo-pequeno">Última edição</span>
          <Veredicto f={f} />
        </div>
        {u ? (
          <div className="numerico">
            {diaMes(u.data)} às {u.hora} · {u.artigos} artigos · mais recente há {idade(u.maisRecenteDias)}
          </div>
        ) : (
          <div className="vazio">{SEM}</div>
        )}
        {frases.length > 0 && (
          <ul className="ficha-frases">
            {frases.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export default function Fichas({ fichas }: { fichas: Ficha[] }) {
  const marcas = new Map<string, Ficha[]>();
  for (const f of fichas) marcas.set(f.marca, [...(marcas.get(f.marca) ?? []), f]);

  return (
    <div className="envolucro fichas">
      <header className="topo">
        <h1>Media Livre — Monitor de Newsletters</h1>
        <p>
          <Link href="/">‹ Voltar ao monitor</Link>
        </p>
      </header>

      <p className="explica">
        O normal de cada newsletter, aprendido com as edições dos últimos 90 dias, e a última edição
        medida contra ele. Conta só a hora de chegada, os artigos e as datas de publicação — nunca o
        aspeto do email, que muda. O perfil fica estável a partir de 10 edições.
      </p>

      {fichas.length === 0 && <p className="vazio">{SEM}</p>}

      {[...marcas].map(([marca, lista]) => (
        <section key={marca}>
          <h2>{marca}</h2>
          <div className="grelha-fichas">
            {lista.map((f) => (
              <CartaoFicha key={f.id} f={f} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
