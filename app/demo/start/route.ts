import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { seedSample } from "@/lib/sample/seed";
import { hasSample, SAMPLE_DESTINATION } from "@/lib/sample/find";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Demo entry point, part 2 (plan Feature 1).
 *
 * A Route Handler rather than a page because the session cookie has to be
 * WRITTEN here, and cookies are read-only in Server Components. The first
 * version signed in anonymously from the page component; the sign-in
 * succeeded, but the cookie write was silently swallowed, the visitor arrived
 * at the project page unauthenticated, and the guard bounced them to /login.
 *
 * Cookie wiring is explicit rather than delegated to lib/supabase/server's
 * client (whose write path try/catches for the RSC case): each cookie the
 * auth client emits goes both into the mutable request store — so
 * seedSample's own client sees the session in this same request and its
 * RLS-checked writes carry auth.uid() — and onto the response, so the browser
 * keeps the session afterwards.
 *
 * The success response is a 200 handoff page with a meta refresh, NOT a 307.
 * A redirect can race the browser's cookie jar: the follow-up request may be
 * dispatched before the Set-Cookie (or a deferred Set-Cookie from some earlier
 * prefetch) has been committed, so the review page authenticates as a
 * different user than the one seedSample just wrote as — and the owner-scoped
 * query returns NotFoundError. With a document response the cookie is
 * committed as part of the load, and only then does the meta refresh navigate.
 */

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return redirectTo(request, "/demo", { setup: "1" }, []);
  }

  const cookieStore = await cookies();
  const pending: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            pending.push({ name, value, options });
            try {
              cookieStore.set(name, value, options);
            } catch {
              // The redirect response below carries them regardless.
            }
          }
        },
      },
    },
  );

  // Reuse an existing session — a visitor who already signed in (e.g. via the
  // magic link) keeps their account rather than getting a second anonymous one.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let userId = user?.id ?? null;

  if (!userId) {
    // Anonymous sign-in gives the visitor a real user id, so RLS isolates
    // their demo data from everyone else's with no special-casing.
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error || !data.user) {
      return redirectTo(request, "/demo", {
        error: error?.message ?? "Anonymous sign-in failed.",
      }, pending);
    }

    userId = data.user.id;
  }

  // A returning visitor whose sample is already seeded goes straight back to
  // it. Re-seeding would wipe any edits they made while exploring (clearSample
  // deletes first) and re-pay the pipeline cost. ?fresh=1 opts back into a
  // clean re-seed — the reset path for repeat demo runs.
  if (request.nextUrl.searchParams.get("fresh") !== "1" && (await hasSample(userId))) {
    return handoff(request, SAMPLE_DESTINATION, {}, pending);
  }

  try {
    await seedSample(userId);
    // The dashboard, not the review page: the sample opens like any other
    // project on the list, and the visitor walks into the assessment from
    // there — the same navigation a real user takes.
    return handoff(request, SAMPLE_DESTINATION, {}, pending);
  } catch (error) {
    return redirectTo(request, "/demo", {
      error: error instanceof Error ? error.message : "Seeding the sample project failed.",
    }, pending);
  }
}

/**
 * The cookie-settling success response: a minimal page whose meta refresh
 * navigates to the target once the document — and its Set-Cookie — has loaded.
 */
function handoff(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
  pending: PendingCookie[],
): NextResponse {
  const target = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

  const url = escapeHtml(target.pathname + target.search);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=${url}">
<title>Opening your sample project…</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText;font:14px/1.6 system-ui,sans-serif}</style>
</head>
<body>
<p>Opening your sample project…</p>
<noscript><p><a href="${url}">Continue to your sample project</a></p></noscript>
</body>
</html>`;

  const response = new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });

  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }

  return response;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function redirectTo(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
  pending: PendingCookie[],
): NextResponse {
  const target = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

  const response = NextResponse.redirect(target);

  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }

  return response;
}
