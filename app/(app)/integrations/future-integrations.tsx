"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The collapsible shelf for the scaffolded integrations (§8): Gmail, CRM
 * sync, and Payments are honest scaffolds — nothing to click, no connection
 * to make — so they start hidden behind one "Future integrations" toggle and
 * only take over the page if the visitor asks for them. Slack, the one
 * integration users actually connect, always stays visible above.
 */
export function FutureIntegrations({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="future-integrations-list"
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-input"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">
            Future integrations
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Gmail, CRM sync, and payments — each lists exactly what it needs
            before it activates.
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div id="future-integrations-list" className="landing-fade-in">
          {children}
        </div>
      ) : null}
    </div>
  );
}
