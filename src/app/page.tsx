import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import { garantirDias, grelhaDoDia, matriz } from "../lib/registos.ts";
import {
  dataLocal,
  diaMes,
  diaSemanaISO,
  horaLocal,
  segundaDaSemana,
  ultimasSemanas,
} from "../lib/tempo.ts";
import Painel, {
  type CelulaMatriz,
  type LinhaDia,
  type LinhaMatriz,
} from "../components/Painel.tsx";

// A página lê o estado atual da base de dados a cada pedido.
export const dynamic = "force-dynamic";

/** Seis semanas ≈ os 30 dias úteis que a spec pedia, mas alinhados à segunda. */
const NR_SEMANAS = 6;

const ABREVIATURAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sá", "Do"];

export default function Pagina() {
  const hoje = dataLocal();

  // Em desenvolvimento o agendador pode ainda não ter corrido; sem isto a
  // primeira visita apanhava a página vazia.
  // Cobre exatamente as semanas que a matriz mostra, senao as primeiras
  // colunas aparecem vazias.
  garantirDias(NR_SEMANAS * 7);

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

  const m = matriz(ultimasSemanas(NR_SEMANAS, hoje));

  const dias = m.dias.map((d) => {
    const dow = diaSemanaISO(d);
    return {
      data: d,
      rotulo: diaMes(d),
      abreviatura: ABREVIATURAS[dow - 1],
      fimDeSemana: dow >= 6,
      // A segunda-feira agrupa a coluna na sua semana.
      semana: segundaDaSemana(d),
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
      nrSemanas={NR_SEMANAS}
    />
  );
}
