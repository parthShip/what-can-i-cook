"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

/**
 * Theme state for the whole app.
 *
 * `system` is the default because the person already told their OS how they want
 * to read at this hour; asking again is a worse first impression than following.
 * Transitions are left enabled: the switch animates the change deliberately (see
 * `theme-sweep` in globals.css), and suppressing them here would kill that too.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
    >
      {children}
    </NextThemeProvider>
  );
}
