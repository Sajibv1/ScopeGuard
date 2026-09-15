import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

/*
 * Two voices, one product: Public Sans (the official-document sans) carries
 * the interface; Newsreader (a reading serif with true italics) carries the
 * landing display headline and the agreement itself.
 */
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ScopeGuard",
    template: "%s · ScopeGuard",
  },
  description:
    "Turn a client's new request into an evidence-backed, estimated change request.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${publicSans.variable} ${newsreader.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
