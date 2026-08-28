import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import { garantirDias, grelhaDoDia, matriz } from "../lib/registos.ts";
import {
  dataLocal,
  diaMes,
  diaSemanaISO,
  horaLocal,
  intervaloDias,
  nomeMes,
  primeiroDiaDoMes,
  segundaDaSemana,
  somarDias,
  somarMeses,
} from "../lib/tempo.ts";
import Painel, {
  type CelulaMatriz,
  type LinhaDia,
  type LinhaMatriz,
} from "../components/Painel.tsx";

// A página lê o estado atual da base de dados a cada pedido.
export const dynamic = "force-dynamic";

/** Quanto cada vista abrange. A mensal manda no intervalo que se carrega. */
const NR_SEMANAS = 6;
const NR_MESES = 3;

const ABREVIATURAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sá", "Do"];

export default function Pagina() {
  const hoje = dataLocal();

  // Carrega-se de uma vez o intervalo da vista mais larga; as outras são
  // fatias dele, para trocar de vista não custar uma ida ao servidor.
  const inicioSemanal = somarDias(segundaDaSemana(hoje), -7 * (NR_SEMANAS - 1));
  const inicioMensal = somarMeses(primeiroDiaDoMes(hoje), -(NR_MESES - 1));
  const inicio = inicioSemanal < inicioMensal ? inicioSemanal : inicioMensal;
  const todosOsDias = intervaloDias(inicio, hoje);

  // Sem isto as primeiras colunas apareciam vazias quando o agendador ainda
  // não tinha corrido para trás.
  garantirDias(todosOsDias.length);

  const grelha: LinhaDia[] = grelhaDoDia(hoje).map((l) => ({
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

  const m = matriz(todosOsDias);

  const dias = m.dias.map((d) => {
    const dow = diaSemanaISO(d);
    return {
      data: d,
      rotulo: diaMes(d),
      abreviatura: ABREVIATURAS[dow - 1],
      fimDeSemana: dow >= 6,
      // As chaves de agrupamento das duas vistas com colunas.
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
      hoje={diaMes(hoje)}
      porConfigurar={porConfigurar}
      grelha={grelha}
      dias={dias}
      linhas={linhas}
      inicioSemanal={inicioSemanal}
      nrSemanas={NR_SEMANAS}
      nrMeses={NR_MESES}
    />
  );
}
