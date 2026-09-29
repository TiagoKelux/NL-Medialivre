/**
 * Saber se o Gmail está configurado sem carregar o cliente IMAP, que só é
 * preciso quando se vai mesmo ler a caixa.
 */
export function temGmail(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}
