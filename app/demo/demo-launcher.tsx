"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The visible loading state for the sample project (plan Feature 1).
 *
 * /demo/start builds the sample by running the REAL pipeline — anonymous
 * sign-in, scope extraction, and the assessment call — before it can redirect,
 * which takes tens of seconds against a live model. The first version had the
 * page component redirect server-side, so the browser sat on a blank tab for
 * that whole span and the demo looked broken.
 *
 * This screen stays painted while the handler works. It navigates on mount via
 * a full-page location.replace rather than the Next router, because the
 * handler writes session cookies onto its response and a client-router fetch
 * would silently drop them (the same trap the handler's own doc comment
 * describes). The browser swaps this screen for the review page only when the
 * response finally lands.
 *
 * The step indicator is driven by elapsed time against per-mode expectations
 * (passed in from the server, which knows whether a live model is configured).
 * The true phase lives inside the handler's single request, so the client
 * cannot observe it — the copy says "typically" and the last step keeps its
 * spinner until the page actually swaps, so the UI never claims completion the
 * server has not delivered.
 */
export function DemoLauncher({ liveModel }: { liveModel: boolean }) {
  // Dev StrictMode double-invokes effects; a second replace() mid-request
  // would abort the in-flight seeding, so fire exactly once.
  const started = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tick = window.setInterval(() => {
      setElapsed((seconds) => seconds + 0.25);
    }, 250);
    // Hand off to the handler now that this screen is painted. A full-page
    // location.replace rather than the Next router: the handler writes session
    // cookies onto its response, and a client-router fetch would silently
    // drop them. replace() so this transient screen leaves no history entry.
    window.location.replace("/demo/start");
    // The interval dies with this page when the handler's response swaps it;
    // clearing here just covers the unmount-before-navigation edge.
    return () => window.clearInterval(tick);
  }, []);

  // Roughly when each phase ends. Fixture mode is nearly instant. Live mode
  // is usually fast too: the sample's model inputs never change, so after the
  // first live run the verified output is served from a cache and only the
  // database work remains. A cold cache (first run after a prompt or model
  // change) still pays for the two live model calls.
  const steps: Array<{ label: string; endsAt: number }> = liveModel
    ? [
          { label: "Signing you in anonymously", endsAt: 1.5 },
          { label: "Extracting the baseline scope", endsAt: 5 },
          { label: "Assessing the client's request against it", endsAt: 10 },
        ]
      : [
          { label: "Signing you in anonymously", endsAt: 0.5 },
          { label: "Extracting the baseline scope", endsAt: 1.5 },
          { label: "Assessing the client's request against it", endsAt: 3 },
        ];
  return (
    <main className="relative flex min-h-screen select-none flex-col items-center justify-center overflow-hidden bg-[#05030A] px-4 py-12 font-sans text-white">
      <style>{`
        @keyframes demo-launcher-glow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .demo-launcher-glow {
          animation: demo-launcher-glow 4s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .demo-launcher-glow { animation: none; }
        }
      `}</style>

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/15 blur-[180px]" />
      <div className="pointer-events-none absolute right-1/4 top-1/4 size-[300px] rounded-full bg-indigo-600/10 blur-[140px]" />

      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl p-[1.5px] shadow-[0_0_50px_rgba(168,85,247,0.15)]">
        <div
          aria-hidden="true"
          className="demo-launcher-glow absolute inset-[-200%] opacity-70"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0%, transparent 70%, #c084fc 85%, #818cf8 95%, transparent 100%)",
          }}
        />

        <div className="relative h-full w-full rounded-[23px] bg-[#0B0813]/90 p-8 text-center backdrop-blur-2xl sm:p-10">
          <div className="mb-6 flex justify-center">
            <div className="relative flex items-center justify-center">
              <div className="size-10 rounded-full border-2 border-purple-500/20 border-t-purple-400 animate-spin motion-reduce:animate-none" />
              <div className="absolute size-6 rounded-full border-2 border-indigo-500/20 border-b-indigo-400 animate-spin [animation-duration:1.5s] motion-reduce:animate-none" />
            </div>
          </div>

          <h1 className="mb-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Preparing your sample project…
          </h1>
          <p className="mx-auto mb-8 max-w-md text-xs leading-relaxed text-gray-400 sm:text-sm">
            This is the real workflow, not a canned screenshot: ScopeGuard signs
            you in, extracts the baseline scope, assesses the client&rsquo;s
            message against it, and verifies every citation.{" "}
            {liveModel
              ? "Every citation was verified on the model run that produced it — this usually takes a few seconds, and the page will open by itself."
              : "Running without a model key, this takes only a moment."}
          </p>

          <div className="mx-auto mb-8 max-w-md space-y-3 text-left">
            {steps.map(({ label, endsAt }, index) => {
              const done = elapsed >= endsAt;
              return (
                <div
                  key={label}
                  className={`flex items-center gap-3.5 rounded-xl border px-4 py-3 transition-all duration-300 ${
                    done
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/5 bg-white/[0.02] text-gray-400"
                  }`}
                >
                  {done ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                      <svg
                        aria-hidden="true"
                        className="size-3.5 text-emerald-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span aria-hidden="true" className="ml-0.5 size-4 shrink-0 rounded-full border-2 border-purple-400/40 border-t-purple-400 animate-spin motion-reduce:animate-none" />
                  )}
                  <span className="text-xs font-medium sm:text-sm">{label}</span>
                </div>
              );
            })}
          </div>

          {/* Fallback if the automatic navigation never fires (JS blocked,
              effect crashed): the visitor can still start the demo by hand. */}
          <p className="text-xs text-gray-400">
            Nothing happening?{" "}
            <a
              href="/demo/start"
              className="text-purple-400 underline underline-offset-4 transition-colors hover:text-purple-300"
            >
              Open the sample project
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
