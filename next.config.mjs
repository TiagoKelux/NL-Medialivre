import { readFileSync } from "node:fs";

function pastaDoBuild() {
  if (process.env.NEXT_DIST_DIR) return process.env.NEXT_DIST_DIR;
  try {
    const ativa = readFileSync(new URL("./.next-ativa", import.meta.url), "utf8").trim();
    if (/^\.next-[ab]$/.test(ativa)) return ativa;
  } catch {}
  return ".next";
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Sem `X-Powered-By: Next.js`: não se anuncia o que corre por trás. */
  poweredByHeader: false,
  /**
   * Pasta do build. No servidor, o deploy alterna entre .next-a e .next-b:
   * constrói a nova com o monitor a correr, escreve o nome em .next-ativa e
   * reinicia. O monitor fica parado segundos, não minutos. O nome fica
   * gravado no build, por isso não se pode mudar a pasta de nome depois.
   */
  distDir: pastaDoBuild(),
  /**
   * Pacotes que têm de ser carregados pelo Node em tempo de execução, não
   * empacotados:
   *  - `better-sqlite3` é um módulo nativo (e as suas duas dependências);
   *  - `@azure/msal-node` arrasta o `jsonwebtoken`, que faz `require("crypto")`
   *    à moda antiga e não sobrevive ao empacotador;
   *  - `imapflow` para ler o Gmail, que é só código de Node.
   */
  serverExternalPackages: [
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "node-cron",
    "@azure/msal-node",
    "jsonwebtoken",
    "@microsoft/microsoft-graph-client",
    "imapflow",
  ],
};

export default nextConfig;
