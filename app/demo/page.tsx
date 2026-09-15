import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { CircleAlert, TriangleAlert } from "lucide-react";

import { isFixtureMode } from "@/lib/ai/provider";
import { getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { hasSample, SAMPLE_DESTINATION } from "@/lib/sample/find";

import { DemoLauncher } from "./demo-launcher";

export const metadata = { title: "Sample project" };

/**
 * The demo entry point (plan Feature 1).
 *
 * This page is only the error/setup surface and the loading state. The actual
 * sign-in and seeding happen in app/demo/start/route.ts — a Route Handler,
 * because the session cookie must be written, and cookies are read-only in
 * page components. The launcher (not a redirect) hands off to it, so the
 * visitor sees progress while the handler runs.
 *
 * A returning visitor whose sample is already seeded never sees the launcher:
 * their session cookie is already in place (no writes needed), so the page can
 * send them straight to the dashboard, which loads with their sample project.
 * Only the first visit pays for the launcher + pipeline.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; error?: string }>;
}) {
  const { setup, error } = await searchParams;

  if (!isSupabaseConfigured() || setup) {
    return (
      <DemoProblem tone="warning" title="The sample project needs a database">
        <p>
          Supabase is not configured. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code>, add your Supabase URL and anon key, and run
          the migrations in <code>supabase/migrations</code>.
        </p>
      </DemoProblem>
    );
  }

  if (error) {
    return (
      <DemoProblem tone="danger" title="The sample project could not be created">
        <p className="mb-3">
          Anonymous sign-in must be enabled in Supabase under{" "}
          <strong>Authentication → Sign In / Providers → Anonymous sign-ins</strong>.
        </p>
        <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-400">
          {error}
        </p>
      </DemoProblem>
    );
  }

  // The launcher's progress steps are time-based; the server knows whether a
  // live model is configured, so it gets honest expectations for the wait.
  const user = await getUser();
  if (user && (await hasSample(user.id))) redirect(SAMPLE_DESTINATION);
  return <DemoLauncher liveModel={!isFixtureMode()} />;
}

function DemoProblem({
  tone,
  title,
  children,
}: {
  tone: "warning" | "danger";
  title: string;
  children: ReactNode;
}) {
  const isWarning = tone === "warning";
  const Icon = isWarning ? TriangleAlert : CircleAlert;

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-x-clip bg-[#05030A] px-4 py-10 text-white">
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/15 blur-[180px]" />
      <div className="relative w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#0B0813]/95 p-6 text-center shadow-[0_0_60px_rgba(124,58,237,0.18)] backdrop-blur-2xl sm:p-10">
        <span
          className={`mx-auto flex size-11 items-center justify-center rounded-full border ${
            isWarning
              ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
              : "border-rose-300/25 bg-rose-300/10 text-rose-200"
          }`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{title}</h1>
        <div className="mt-3 text-sm leading-relaxed text-gray-400 [&_code]:rounded [&_code]:border [&_code]:border-white/10 [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_strong]:font-medium [&_strong]:text-gray-200">
          {children}
        </div>
      </div>
    </main>
  );
}
