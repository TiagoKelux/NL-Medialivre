/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Pacotes que têm de ser carregados pelo Node em tempo de execução, não
   * empacotados:
   *  - `better-sqlite3` é um módulo nativo (e as suas duas dependências);
   *  - `@azure/msal-node` arrasta o `jsonwebtoken`, que faz `require("crypto")`
   *    à moda antiga e não sobrevive ao empacotador.
   */
  serverExternalPackages: [
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "node-cron",
    "@azure/msal-node",
    "jsonwebtoken",
    "@microsoft/microsoft-graph-client",
  ],
};

export default nextConfig;
