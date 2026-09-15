import Link from "next/link";
import { Plug } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { getUser } from "@/lib/auth";

/**
 * The app header — the landing navbar's quiet sibling: the same § badge
 * lockup and glassy blur, but sticky workspace chrome instead of scroll
 * choreography. The theme toggle (now the day/night switch) sits at the far
 * right.
 */
export async function AppHeader() {
  const user = await getUser();

  return (
    <header className="no-print sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/20 font-serif text-base font-bold text-purple-300 shadow-[0_0_15px_rgb(168_85_247/0.3)]"
          >
            §
          </span>
          ScopeGuard
        </Link>

        <div className="flex items-center gap-2 text-sm sm:gap-3">
          {/*
            Icon-only on phones (with an sr-only name), text from sm up —
            Integrations must stay reachable from the app chrome at every
            width. The px/py on every text control keeps each hit area above
            the 24px WCAG 2.2 minimum.
          */}
          <Link
            href="/integrations"
            className="inline-flex items-center rounded-md px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plug aria-hidden className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Integrations</span>
            <span className="sr-only sm:hidden">Integrations</span>
          </Link>
          {user?.isAnonymous ? (
            <>
              {/* Always visible: anonymous users must know their work is
                  unsaved, on phones too. */}
              <span className="rounded-full border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs font-medium text-notice-warn-fg">
                Sample session
              </span>
              <Link
                href="/login"
                className="inline-flex items-center rounded-md px-1 py-2 text-primary underline underline-offset-2 hover:text-primary/80"
              >
                <span className="sm:hidden">Sign in</span>
                <span className="hidden sm:inline">Sign in to save work</span>
              </Link>
            </>
          ) : user ? (
            <>
              <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:inline">
                {user.email}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center rounded-md px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
