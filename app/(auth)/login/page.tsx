"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useActionState } from "react";

import { signInWithEmail, type AuthState } from "../actions";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signInWithEmail,
    {},
  );

  if (state.sent) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-left text-sm text-emerald-200">
        <p className="font-medium">Check your email</p>
        <p>
          We sent you a sign-in link. Open it on this device to continue. You can close this
          tab.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label
          htmlFor="email"
          className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-1.5"
        >
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="Enter your email address"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/60 transition-all"
        />
      </div>

      {state.error ? (
        <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs leading-relaxed text-rose-200" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="group relative inline-flex items-center justify-center w-full px-8 py-3.5 rounded-[12px] bg-slate-950 text-white font-medium text-sm text-center overflow-hidden transition-all duration-300 mt-2 shadow-lg shadow-purple-950/20 cursor-pointer disabled:opacity-50"
      >
        <span className="absolute inset-0 rounded-[12px] bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-600 p-[1px] transition-all duration-500 group-hover:opacity-100 opacity-70" />
        <span className="absolute inset-[1px] rounded-[11px] bg-[#0B0813] transition-colors duration-300 group-hover:bg-[#120D1F]" />
        <span className="relative z-10 flex items-center justify-center gap-2 text-white font-medium tracking-wide">
          {pending ? "Sending link…" : "Email me a sign-in link"}
        </span>
        <span className="absolute inset-0 -translate-x-full rounded-[12px] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />
      </button>

      <p className="text-xs leading-relaxed text-gray-400">
        No password. We&rsquo;ll email you a link that signs you in.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen select-none flex-col items-center justify-center overflow-hidden bg-[#05030A] px-4 py-12 text-white">
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[#0B0813] p-8">
        <Link
          href="/"
          className="absolute right-5 top-5 z-20 rounded-xl p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </Link>

        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 font-serif text-lg font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              §
            </span>
            <span className="text-2xl font-bold tracking-tight text-white">ScopeGuard</span>
          </div>
          <p className="text-xs text-gray-400">
            Sign in to access your projects and evidence reports
          </p>
        </div>

        <Suspense fallback={<div className="h-40" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-8 text-center text-xs text-gray-400">
          Want to look around first?{" "}
          <Link href="/demo" className="font-medium text-purple-400 transition-colors hover:text-purple-300">
            Try the sample project
          </Link>
        </p>
      </div>
    </main>
  );
}
