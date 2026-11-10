import { listarAvisos } from "../../lib/avisos.ts";
import { remetentesAutorizados } from "../../lib/avisos-remetentes.ts";
import { temChaveIA, modeloIA } from "../../lib/interpretar-aviso.ts";
import { listarPausas } from "../../lib/pausas.ts";
import { NEWSLETTERS } from "../../../config/newsletters.ts";
import { dataLocal } from "../../lib/tempo.ts";
import Avisos from "../../components/Avisos.tsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Avisos e pausas — Media Livre",
};

export default function Pagina() {
  return (
    <Avisos
      avisos={listarAvisos()}
      pausas={listarPausas()}
      newsletters={NEWSLETTERS.filter((n) => n.ativa).map((n) => ({ id: n.id, rotulo: `${n.marca} · ${n.nome}` }))}
      remetentes={remetentesAutorizados()}
      ia={temChaveIA() ? modeloIA() : null}
      hoje={dataLocal()}
    />
  );
}
