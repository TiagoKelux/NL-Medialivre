import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import { garantirDias, grelhaDoDia, matriz } from "../lib/registos.ts";
import { calcularPeriodo, diasDoPeriodo, ehVista } from "../lib/periodo.ts";
import {
  dataLocal,
  diaMes,
  diaSemanaISO,
  horaLocal,
  nomeMes,
  primeiroDiaDoMes,
  segundaDaSemana,
} from "../lib/tempo.ts";
import Painel, {
  type CelulaMatriz,
  type LinhaDia,
  type LinhaMatriz,
} from "../components/Painel.tsx";

// A página lê o estado atual da base de dados a cada pedido.
export const dynamic = "force-dynamic";

const ABREVIATURAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sá", "Do"];

/** Quantos dias para trás se garante que existem registos. */
const HISTORICO = 120;

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const hoje = dataLocal();

  const pedida = typeof params.vista === "string" ? params.vista : null;
  const vista = ehVista(pedida) ? pedida : "diaria";
  const ancora = typeof params.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.ate)
    ? params.ate
    : hoje;

  const periodo = calcularPeriodo(vista, ancora, hoje);
  const dias = diasDoPeriodo(periodo, hoje);

  // Sem isto, recuar no histórico apanhava colunas vazias.
  garantirDias(HISTORICO);

  // A vista diária mostra o dia da âncora, não necessariamente hoje.
  const grelha: LinhaDia[] = grelhaDoDia(periodo.de).map((l) => ({
    newsletterId: l.newsletter_id,
    marca: l.marca,
    nome: l.nome,
    horaPrevista: l.hora_prevista,
    horaRecebida: l.hora_recebida ? horaLocal(new Date(l.hora_recebida)) : null,
    atraso:
      l.atraso_minutos === null || l.atraso_minutos === 0
        ? null
        : `${l.atraso_minutos} min`,
    codigo: l.codigo_estado,
    detalhe: l.detalhe,
    fechado: l.fechado === 1,
    periodicidade: l.periodicidade,
    diasSemana: l.dias_semana,
  }));

  const m = matriz(dias);

  const colunas = m.dias.map((d) => {
    const dow = diaSemanaISO(d);
    return {
      data: d,
      rotulo: diaMes(d),
      abreviatura: ABREVIATURAS[dow - 1],
      fimDeSemana: dow >= 6,
      semana: segundaDaSemana(d),
      mes: primeiroDiaDoMes(d),
      mesRotulo: nomeMes(d),
      hoje: d === hoje,
    };
  });

  const linhas: LinhaMatriz[] = m.linhas.map((l) => ({
    newsletterId: l.newsletter.id,
    marca: l.newsletter.marca,
    nome: l.newsletter.nome,
    periodicidade: l.newsletter.periodicidade,
    diasSemana: l.newsletter.diasSemana,
    celulas: l.celulas as (CelulaMatriz | null)[],
  }));

  const porConfigurar = NEWSLETTERS.filter((n) => !estaConfigurada(n)).map(
    (n) => `${n.marca} ${n.nome}`,
  );

  return (
    <Painel
      hoje={hoje}
      periodo={periodo}
      porConfigurar={porConfigurar}
      grelha={grelha}
      dias={colunas}
      linhas={linhas}
    />
  );
}
