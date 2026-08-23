import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "HandyLine AI — Receptionist Dashboard",
  description: "AI phone receptionist for home services contractors",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full bg-gray-50 antialiased" suppressHydrationWarning>
        <div className="min-h-full flex flex-col">
          <header className="bg-white border-b border-gray-200">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex h-16 items-center justify-between">
                <div className="flex items-center gap-8">
                  <Link href="/" className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: "#e87a1e" }}>
                      H
                    </div>
                    <span className="text-lg font-semibold text-gray-900">HandyLine AI</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">demo</span>
                  </Link>
                  <nav className="hidden md:flex items-center gap-6 text-sm">
                    <Link href="/" className="text-gray-700 hover:text-gray-900">
                      Work Orders
                    </Link>
                    <Link href="/landing" className="text-gray-700 hover:text-gray-900" target="_blank" rel="noopener noreferrer">
                      Marketing Page ↗
                    </Link>
                    <Link href="/config" className="text-gray-700 hover:text-gray-900">
                      Settings
                    </Link>
                  </nav>
                </div>
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
