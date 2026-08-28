import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Media Livre — Monitor de Newsletters",
  description: "Estado diário das newsletters, lido diretamente da caixa de correio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
