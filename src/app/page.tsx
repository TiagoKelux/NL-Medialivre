import { estaConfigurada, newsletterPorId } from "../../config/newsletters.ts";
import { PAGAS } from "../../config/pagas.ts";
import { estadoLeitura } from "../lib/leitura.ts";
import { vigilanciaListas } from "../lib/caixa.ts";
import { extrairNome } from "../lib/correspondencia.ts";
import { garantirDias, grelhaDoDia, matriz } from "../lib/registos.ts";
import { contarPorClassificar } from "../lib/regras.ts";
import { calcularPeriodo, diasDoPeriodo, ehData, ehVista } from "../lib/periodo.ts";
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
  type ListaSilencioAviso,
  type ReconquistaAviso,
  type CelulaMatriz,
  type LinhaDia,
  type LinhaMatriz,
} from "../components/Painel.tsx";
import { duracao } from "../lib/classificacao.ts";

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
  const ancora = ehData(params.ate) ? params.ate : hoje;

  const periodo = calcularPeriodo(vista, ancora, hoje);
  const dias = diasDoPeriodo(periodo, hoje);

  // Sem isto, recuar no histórico apanhava colunas vazias.
  garantirDias(HISTORICO);

  // A vista diária mostra o dia da âncora, não necessariamente hoje.
  const grelha: LinhaDia[] = grelhaDoDia(periodo.de).map((l) => {
    const n = newsletterPorId(l.newsletter_id);
    return {
      newsletterId: l.newsletter_id,
      semEmail: !n || !estaConfigurada(n),
      paga: PAGAS.has(l.newsletter_id),
      marca: l.marca,
      nome: l.nome,
      horaPrevista: l.hora_prevista,
      horaRecebida: l.hora_recebida ? horaLocal(new Date(l.hora_recebida)) : null,
      atraso:
        l.atraso_minutos === null || l.atraso_minutos === 0
          ? null
          : duracao(l.atraso_minutos),
      codigo: l.codigo_estado,
      detalhe: l.detalhe,
      fechado: l.fechado === 1,
      limitePassou: l.limite_passou,
      periodicidade: l.periodicidade,
      diasSemana: l.dias_semana,
      temConteudo: l.tem_conteudo,
      ressalva: l.ressalva ?? null,
      fonte: l.fonte ?? null,
    };
  });

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
    semEmail: !estaConfigurada(l.newsletter),
    paga: PAGAS.has(l.newsletter.id),
    marca: l.newsletter.marca,
    nome: l.newsletter.nome,
    periodicidade: l.newsletter.periodicidade,
    diasSemana: l.newsletter.diasSemana,
    celulas: l.celulas as (CelulaMatriz | null)[],
  }));

  // Newsletters que deixaram de chegar a esta caixa, uma a uma, e os emails de
  // reconquista recentes (lib/caixa.ts). Sem isto, os "Não recebida – sem
  // prova" liam-se como newsletters falhadas. O editor corta lista a lista:
  // a contagem por domínio dizia "normalizada" com listas mortas.
  let listasEmSilencio: ListaSilencioAviso[] = [];
  let reconquistas: ReconquistaAviso[] = [];
  try {
    const v = vigilanciaListas();
    listasEmSilencio = v.listas.map((l) => ({
      nome: `${l.marca} ${l.nome}`,
      nivel: l.nivel,
      desde: diaMes(l.desde),
      edicoesEmFalta: l.edicoesEmFalta,
    }));
    reconquistas = v.reconquistas.map((r) => ({
      dia: diaMes(dataLocal(new Date(r.recebidoEm))),
      assunto: r.assunto,
      remetente: extrairNome(r.remetente) || r.remetente,
      aberto: r.abertura === "aberto",
      abertoAs: r.abertoEm ? horaLocal(new Date(r.abertoEm)) : null,
    }));
  } catch {
    listasEmSilencio = [];
    reconquistas = [];
  }

  return (
    <Painel
      hoje={hoje}
      leitura={estadoLeitura()}
      listasEmSilencio={listasEmSilencio}
      reconquistas={reconquistas}
      porClassificar={contarPorClassificar(7)}
      periodo={periodo}
      grelha={grelha}
      dias={colunas}
      linhas={linhas}
    />
  );
}
