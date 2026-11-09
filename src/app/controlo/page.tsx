import { comparacao } from "../../lib/importar-controlo.ts";
import Controlo from "../../components/Controlo.tsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Controlo do cliente — Media Livre",
};

export default function Pagina() {
  return <Controlo dados={comparacao()} />;
}
