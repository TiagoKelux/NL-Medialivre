import { NEWSLETTERS, newsletterPorId } from "../../../config/newsletters.ts";
import { partesDaMarca } from "../../lib/regras-fusao.ts";
import {
  estadoNewsletters,
  lerExclusoes,
  lerRegras,
  porClassificar,
  ultimasAlteracoes,
} from "../../lib/regras.ts";
import { dataLocal, diaMes, horaLocal } from "../../lib/tempo.ts";
import Classificar, { type OpcaoNewsletter } from "../../components/Classificar.tsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Por classificar — Media Livre",
};

/** Emails por atribuir dos últimos N dias que a página mostra. */
const DIAS = 30;

function quando(iso: string): string {
  const d = new Date(iso);
  return `${diaMes(dataLocal(d))} ${horaLocal(d)}`;
}

function haQuanto(iso: string, agora: Date): string {
  const dias = Math.round(
    (new Date(`${dataLocal(agora)}T00:00:00Z`).getTime() -
      new Date(`${dataLocal(new Date(iso))}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/** "/4196/JORNALDENEGOCIOS_MASTHEAD/NEWSLETTER_LEX_LEADERBOARD" → "JORNALDENEGOCIOS · LEX". */
function marcaLegivel(marca: string): string {
  const p = partesDaMarca(marca);
  return p ? `${p.marca} · ${p.nome.replace(/_/g, " ")}` : marca;
}

export default function PaginaClassificar() {
  const agora = new Date();
  const emails = porClassificar(DIAS);
  const regras = lerRegras();
  const estado = estadoNewsletters();

  const opcoes: OpcaoNewsletter[] = [...NEWSLETTERS]
    .sort((a, b) => Number(b.ativa) - Number(a.ativa))
    .map((n) => ({ id: n.id, marca: n.marca, nome: n.nome, ativa: n.ativa }));

  return (
    <Classificar
      dias={DIAS}
      emails={emails.map((e) => ({
        id: e.id,
        nome: e.nome,
        endereco: e.endereco,
        assunto: e.assunto,
        quando: quando(e.recebidoEm),
        marcas: e.marcas.map((m) => ({ valor: m, rotulo: marcaLegivel(m) })),
        sugestao: e.sugestao,
      }))}
      opcoes={opcoes}
      estado={estado.map((s) => ({
        id: s.id,
        marca: s.marca,
        nome: s.nome,
        paga: s.paga,
        configurada: s.configurada,
        origem: s.origem,
        ultima: s.ultima ? `${quando(s.ultima)} · ${haQuanto(s.ultima, agora)}` : null,
      }))}
      regras={regras.map((r) => {
        const n = newsletterPorId(r.newsletterId);
        return {
          id: r.id,
          newsletter: n ? `${n.marca} · ${n.nome}` : r.newsletterId,
          remetente: r.remetente,
          marca: marcaLegivel(r.marcaCorpo),
          marcaCompleta: r.marcaCorpo,
        };
      })}
      exclusoes={lerExclusoes().map((x) => ({
        id: x.id,
        tipo: x.tipo,
        rotulo: x.rotulo,
        quando: quando(x.criadoEm),
      }))}
      alteracoes={ultimasAlteracoes(15).map((a) => ({
        id: a.id,
        quando: quando(a.em),
        quem: a.quem,
        acao: a.acao,
        detalhe: a.detalhe,
      }))}
    />
  );
}
