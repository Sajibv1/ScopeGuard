"use client";

import Link from "next/link";

/*
 * The landing hero from the DOnttakeeverythng design: dot grid, the two
 * rotated "wing" frames bleeding off-screen (floating forever, the right
 * one a beat behind), staggered entrance choreography, and the glowing
 * gradient-border CTA with a hover shine sweep. Buttons go to this app's
 * real routes — /demo for the sample, /login or /dashboard for the
 * account path. Once the visitor's sample is seeded, demoHref points at the
 * existing project instead of /demo, so the primary CTA reopens it rather
 * than re-triggering the seeding pipeline. The reference's framer-motion is
 * reproduced with the landing-* CSS animations.
 */
export function LandingBanner({
  signedIn,
  demoHref,
}: {
  signedIn: boolean;
  demoHref: string;
}) {
  const demoReady = demoHref !== "/demo";
  return (
    <section className="relative min-h-screen w-full pt-36 pb-28 flex flex-col justify-center items-center overflow-hidden bg-[#05030A] text-white">
      {/* ----------------- Background (Dot Grid & Wings) ----------------- */}

      {/* 1. Dot Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30 -z-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* 2. Left Wing Shape, floating */}
      <div className="landing-wing-left absolute top-1/2 -left-[420px] sm:-left-[360px] lg:-left-[320px] w-[520px] h-[520px] rounded-[90px] bg-gradient-to-tr from-[#120724] via-[#3B1566] to-[#A855F7] p-[1.5px] opacity-90 shadow-[0_0_90px_rgba(168,85,247,0.25)] pointer-events-none -z-0">
        <div className="w-full h-full bg-[#05030A] rounded-[88px] relative overflow-hidden">
          <div className="absolute top-1/2 right-0 -translate-y-1/2 w-48 h-48 bg-purple-500 rounded-full blur-[75px] opacity-75" />
        </div>
      </div>

      {/* 3. Right Wing Shape, floating a beat behind */}
      <div className="landing-wing-right absolute top-1/2 -right-[420px] sm:-right-[360px] lg:-right-[320px] w-[520px] h-[520px] rounded-[90px] bg-gradient-to-bl from-[#120724] via-[#3B1566] to-[#A855F7] p-[1.5px] opacity-90 shadow-[0_0_90px_rgba(168,85,247,0.25)] pointer-events-none -z-0">
        <div className="w-full h-full bg-[#05030A] rounded-[88px] relative overflow-hidden">
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-48 h-48 bg-purple-500 rounded-full blur-[75px] opacity-75" />
        </div>
      </div>

      {/* ----------------- Banner Content ----------------- */}
      <div className="relative max-w-4xl mx-auto px-6 sm:px-8 lg:px-10 z-10 text-center flex flex-col items-center">
        {/* Top Badge Pill */}
        <div className="landing-enter inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 border border-purple-500/30 backdrop-blur-xl mb-10 shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:border-purple-500/50 transition-all cursor-pointer">
          <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-medium text-white flex items-center gap-1 border border-white/10">
            <span>🪄</span> What&rsquo;s New
          </span>
          <span className="text-[11px] text-gray-300 font-medium flex items-center gap-1">
            Get Early Access <span className="text-purple-400">→</span>
          </span>
        </div>

        {/* Main Headline */}
        <h1
          className="landing-enter text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.3] text-white max-w-3xl mb-8"
          style={{ animationDelay: "0.2s" }}
        >
          Turn a client&rsquo;s new request into an{" "}
          <span className="bg-gradient-to-r from-purple-300 via-indigo-300 to-pink-300 bg-clip-text text-transparent">
            evidence-backed
          </span>{" "}
          change request.
        </h1>

        {/* Subtitle Text */}
        <p
          className="landing-enter text-xs sm:text-sm text-gray-400 max-w-xl mx-auto mb-12 leading-relaxed font-normal"
          style={{ animationDelay: "0.4s" }}
        >
          Paste the agreement you actually work from and the message your client
          just sent. ScopeGuard quotes the document rather than guessing — then
          you decide, you price it, and it writes the reply.
        </p>

        {/* Action Buttons */}
        <div
          className="landing-enter flex flex-col sm:flex-row items-center justify-center gap-4"
          style={{ animationDelay: "0.6s" }}
        >
          <Link
            href={demoHref}
            className="group relative inline-flex items-center justify-center w-full sm:w-auto px-8 py-3.5 rounded-full bg-slate-950 text-white font-semibold text-xs sm:text-sm text-center overflow-hidden transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-purple-950/20"
          >
            {/* Glowing animated border & background glow */}
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-600 p-[1px] transition-all duration-500 group-hover:opacity-100 opacity-70" />

            <span className="absolute inset-[1px] rounded-full bg-[#0B0813] transition-colors duration-300 group-hover:bg-[#120D1F]" />

            {/* Button content */}
            <span className="relative z-10 flex items-center justify-center gap-2 text-white font-medium tracking-wide">
              {demoReady ? "Open your sample project" : "Try a sample project"}
              <span className="inline-block transition-transform duration-300 group-hover:translate-x-1.5 text-purple-400">
                →
              </span>
            </span>

            {/* Hover shine effect */}
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
          </Link>

          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="w-full sm:w-auto px-8 py-3 rounded-full bg-white/5 border border-white/10 text-white font-medium text-xs sm:text-sm hover:bg-white/10 backdrop-blur-md transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] text-center"
          >
            {signedIn ? "Go to your projects" : "Sign in to create a project"}
          </Link>
        </div>
      </div>
    </section>
  );
}
