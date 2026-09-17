import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLink } from "@/components/nav-link";
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
  title: { default: "Binder", template: "%s · Binder" },
  description: "Inventory and profit tracking for Pokémon TCG vendors",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
            <span className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="grid size-6 place-items-center rounded-md bg-amber-400 text-xs font-bold text-amber-950">
                B
              </span>
              <span className="max-sm:sr-only">Binder</span>
            </span>
            <nav className="flex gap-1 text-sm">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/inventory">Inventory</NavLink>
              <NavLink href="/quick">Buy / Sell</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
