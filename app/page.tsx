import { LandingNavbar } from "@/components/landing/navbar";
import { LandingBanner } from "@/components/landing/banner";
import { LandingWorkflow } from "@/components/landing/workflow";
import { LandingFeatures } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { hasSample, SAMPLE_DESTINATION } from "@/lib/sample/find";

/*
 * The landing page: navbar, banner, workflow, features, footer.
 */
export default async function LandingPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await getUser() : null;
  // Opening the sample project signs the visitor in anonymously, so a demo
  // session is not a signed-in account: the CTAs stay "Sign in" until the
  // visitor signs in for real.
  const signedIn = Boolean(user && !user.isAnonymous);
  // But a demo session DOES mean the sample exists: the demo CTAs flip from
  // "start a demo" to "open your sample" so a returning visitor is never
  // bounced through the seeding pipeline (and its wipe-on-reseed) again.
  // The destination is the dashboard — the sample opens like any other
  // project on the list.
  const sample = user ? await hasSample(user.id) : false;
  const demoHref = sample ? SAMPLE_DESTINATION : "/demo";

  return (
    <div className="min-h-dvh bg-[#05030A] text-white">
      <LandingNavbar signedIn={signedIn} demoHref={demoHref} />
      <main>
        <LandingBanner signedIn={signedIn} demoHref={demoHref} />
        <LandingWorkflow />
        <LandingFeatures />
      </main>
      <LandingFooter />
    </div>
  );
}
