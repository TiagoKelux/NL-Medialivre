import { fichas } from "../../lib/fichas.ts";
import Fichas from "../../components/Fichas.tsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fichas das newsletters — Media Livre",
};

export default function Pagina() {
  return <Fichas fichas={fichas()} />;
}
