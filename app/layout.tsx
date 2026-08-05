import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parallel Bible",
  description: "A quiet, bilingual Bible reader with highlights and notes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/t2cn.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
