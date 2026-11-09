import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import crest from "@/assets/vik-crest.png";
import { BottomNav } from "@/components/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { SettingsLink } from "@/components/settings-link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VIK Playmaker",
  description: "Nivåanpassade träningsgrupper för laget, byggda från anmälningarna på svenskalag.se.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0053a1" },
    { media: "(prefers-color-scheme: dark)", color: "#004281" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sv" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 border-b-2 border-gold bg-brand pt-[env(safe-area-inset-top)] text-white">
          <div className="mx-auto grid h-14 w-full max-w-3xl grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3 px-4">
            <Image src={crest} alt="Vendelsö IK:s klubbmärke" height={40} loading="eager" />
            <Suspense>
              <PageTitle />
            </Suspense>
            <Suspense>
              <SettingsLink />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
        <Suspense>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
