import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import { garantirDias, grelhaDoDia, matriz } from "../lib/registos.ts";
import { dataLocal, diaMes, diaSemanaISO, horaLocal } from "../lib/tempo.ts";
import Painel, {
  type CelulaMatriz,
  type LinhaDia,
  type LinhaMatriz,
} from "../components/Painel.tsx";

// A página lê o estado atual da base de dados a cada pedido.
export const dynamic = "force-dynamic";

export default function Pagina() {
  const hoje = dataLocal();

  // Em desenvolvimento o agendador pode ainda não ter corrido; sem isto a
  // primeira visita apanhava a página vazia.
  garantirDias(30);

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
  }));

  const m = matriz(30, hoje);

  const dias = m.dias.map((d) => ({
    data: d,
    rotulo: diaMes(d),
    fimDeSemana: diaSemanaISO(d) >= 6,
  }));

  const linhas: LinhaMatriz[] = m.linhas.map((l) => ({
    newsletterId: l.newsletter.id,
    marca: l.newsletter.marca,
    nome: l.newsletter.nome,
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
    />
  );
}
