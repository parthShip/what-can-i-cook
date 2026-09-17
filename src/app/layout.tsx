import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// The interface voice: everything the app itself says.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

// The cookbook voice: recipe titles, ingredients, steps — anything quoted out of
// the corpus. SOFT is carried so headlines can soften their terminals; opsz lets
// the same family set a 2rem headline and a 13px label without either breaking.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "What Can I Cook?",
  description:
    "Tell me what is in your fridge and I will find a recipe you can actually make.",
};

// Matches the two grounds in globals.css, so the browser chrome on mobile is the
// same colour as the page rather than a bright bar above a dark app.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbf6" },
    { media: "(prefers-color-scheme: dark)", color: "#221d26" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script below sets the class on <html>
    // before React hydrates, so the server markup deliberately does not match.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      {/* The dynamic viewport is anchored once, here: on mobile 100vh is taller
          than the visible area, and every page below inherits this height. */}
      <body className="flex h-dvh flex-col overflow-hidden">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
