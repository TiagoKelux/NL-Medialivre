import { comparacao } from "../../lib/importar-controlo.ts";
import Controlo from "../../components/Controlo.tsx";
import { remetentesDoControlo, ultimoExcelPorEmail } from "../../lib/controlo-email.ts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Controlo do cliente — Media Livre",
};

export default function Pagina() {
  return <Controlo dados={comparacao()} porEmail={ultimoExcelPorEmail()} remetentes={remetentesDoControlo()} />;
}
