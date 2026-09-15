import { Loader2 } from "lucide-react";

/**
 * Route-level loading state for the authenticated surfaces. Most visibly, the
 * demo's /demo/start handler redirects here right after its long pipeline —
 * without this file that first paint of the review page is another blank span
 * while the server component fetches project, scope, and analysis rows.
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 text-sm text-muted-foreground"
      >
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Loading…
      </div>
    </div>
  );
}
