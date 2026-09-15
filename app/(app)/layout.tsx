import { AppHeader } from "@/components/app-header";

/**
 * Wide by default (the two-column workspaces want the room); narrow form
 * pages constrain themselves with max-w-3xl wrappers.
 *
 * The fixed violet nebula at the top echoes the landing's glow — one quiet
 * ambient wash behind the workspace, nothing more.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(65%_100%_at_50%_0%,rgb(124_58_237/0.16),transparent_75%)]"
      />
      {/* Keyboard users otherwise tab through the sticky header on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-foreground"
      >
        Skip to content
      </a>
      <AppHeader />
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
