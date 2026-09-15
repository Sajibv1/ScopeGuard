"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Class-based theme switching (attribute="class") with light as the default —
 * the workspace opens on the white day variant, and the toggle switches to
 * the dark "cosmic violet" night palette. The landing, sign-in, and demo
 * surfaces hardcode the night palette and do not read the theme class at
 * all, so they are unaffected by this default. next-themes injects the
 * class before paint, so no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
