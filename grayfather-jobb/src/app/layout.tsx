import type { Metadata, Viewport } from "next";
import { Figtree, Syne } from "next/font/google";
import Script from "next/script";
import { TelegramBoot } from "@/components/TelegramBoot";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Grayfather Jobb — för arbetsgivare",
  description:
    "Telegram-sida för arbetsgivare som söker anställda via Grayfather-communityn.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#e8eef4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body className={`${syne.variable} ${figtree.variable} antialiased`}>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <TelegramBoot />
        {children}
      </body>
    </html>
  );
}
