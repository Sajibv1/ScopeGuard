import Link from "next/link";

/*
 * The landing footer from the DOnttakeeverythng design: dark ground with a
 * soft purple glow rising from the bottom, brand mark, links, and copyright
 * in one row. Links keep this app's real routes — the sample project lives
 * at /demo and there are no pricing or privacy pages, so those entries from
 * the reference were dropped.
 */
export function LandingFooter() {
  return (
    <footer className="relative bg-[#05030A] text-gray-400 border-t border-white/10 overflow-hidden">
      {/* Subtle bottom purple glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[150px] bg-purple-900/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-12 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo & brand name */}
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-transform duration-200 hover:scale-105"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-900/30 border border-purple-500/30 flex items-center justify-center font-bold text-purple-300 text-sm shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              §
            </div>
            <span className="text-lg font-bold tracking-tight text-white">
              ScopeGuard
            </span>
          </Link>

          {/* Navigation links */}
          <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-8 text-xs font-medium">
            {[
              { name: "Features", href: "#features" },
              { name: "How It Works", href: "#how-it-works" },
              { name: "Sample Project", href: "/demo" },
            ].map((link) => (
              <span
                key={link.name}
                className="transition-transform duration-200 hover:-translate-y-0.5"
              >
                <Link
                  href={link.href}
                  className="hover:text-white transition-colors duration-200"
                >
                  {link.name}
                </Link>
              </span>
            ))}
          </div>

          {/* Copyright */}
          <div className="text-xs text-gray-500">
            © {new Date().getFullYear()} ScopeGuard. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
