import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mikael’s tips – Topptipset, Powerplay & Oddset",
  description:
    "Mikael’s tips: öppna Topptipset-, Powerplay- och Oddset-spel (fotboll 1X2, Hockey · 1X2 × 9 och Över 1,5) som går att tippa nu.",
  appleWebApp: {
    capable: true,
    title: "Mikael’s tips",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07131f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&family=Oswald:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
