"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/*
 * The landing navbar from the DOnttakeeverythng design: transparent at the
 * top, gaining a blurred backdrop and border once scrolled, and hiding on
 * scroll-down / returning on scroll-up. Links keep this app's real routes —
 * the sample project lives at /demo and the pill button is always the
 * account CTA: "Sign in" when signed out, "Your projects" when signed in.
 * Once the visitor's sample project is seeded, the demo links flip from
 * /demo (which triggers the seeding pipeline) straight to the existing
 * project. The reference's framer-motion scroll choreography is reproduced
 * with a scroll listener and CSS transitions.
 */
export function LandingNavbar({
  signedIn,
  demoHref,
}: {
  signedIn: boolean;
  demoHref: string;
}) {
  const demoReady = demoHref !== "/demo";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      setIsScrolled(currentScrollY > 50);

      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false); // Hide on scroll down
      } else {
        setIsVisible(true); // Show on scroll up or top
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out ${
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      } ${
        isScrolled
          ? "bg-[#05030A]/80 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/40"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo Section */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 text-white font-bold text-xl tracking-wide group"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 font-serif text-lg font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)] group-hover:scale-105 transition-transform">
                §
              </span>
              <span className="text-white font-bold tracking-tight">
                ScopeGuard
              </span>
            </Link>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-2 p-1.5 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-md">
            <Link
              href="#features"
              className="px-4 py-1.5 text-xs uppercase tracking-wider font-semibold text-gray-300 rounded-full hover:text-purple-300 hover:bg-purple-500/10 hover:border-purple-500/30 border border-transparent transition-all duration-200"
            >
              Features
            </Link>
            <Link
              href="#how-it-works"
              className="px-4 py-1.5 text-xs uppercase tracking-wider font-semibold text-gray-300 rounded-full hover:text-purple-300 hover:bg-purple-500/10 hover:border-purple-500/30 border border-transparent transition-all duration-200"
            >
              How It Works
            </Link>
            <Link
              href={demoHref}
              className="px-4 py-1.5 text-xs uppercase tracking-wider font-semibold text-gray-300 rounded-full hover:text-purple-300 hover:bg-purple-500/10 hover:border-purple-500/30 border border-transparent transition-all duration-200"
            >
              Sample Project
            </Link>
          </div>

          {/* Action Buttons */}
          <div className="hidden md:flex items-center space-x-3">
            {/* Demo link with hover underline effect */}
            <Link
              href={demoHref}
              className="relative text-sm font-medium text-gray-300 hover:text-white px-3 py-2 transition-colors duration-300 group"
            >
              <span>{demoReady ? "Open your sample" : "Try the demo"}</span>
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-0 h-[2px] bg-gradient-to-r from-purple-500 to-indigo-400 rounded-full transition-all duration-300 group-hover:w-4/5 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
            </Link>

            <Link
              href={signedIn ? "/dashboard" : "/login"}
              className="px-5 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 backdrop-blur-md text-sm font-medium text-white transition-all shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:border-purple-500/40"
            >
              {signedIn ? "Your projects" : "Sign in"}
            </Link>
          </div>

          {/* Mobile Toggle Button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              type="button"
              aria-label="Toggle menu"
              aria-expanded={isMobileMenuOpen}
              className="text-gray-400 hover:text-white focus:outline-none p-2"
            >
              {isMobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      <div
        className={`md:hidden bg-[#05030A]/95 border-b border-white/10 px-4 backdrop-blur-xl overflow-hidden transition-all duration-300 ease-in-out ${
          isMobileMenuOpen ? "max-h-96 pt-2 pb-6 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="space-y-3">
          <Link
            href="#features"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block text-gray-300 hover:text-purple-300 py-2 font-medium"
          >
            Features
          </Link>
          <Link
            href="#how-it-works"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block text-gray-300 hover:text-purple-300 py-2 font-medium"
          >
            How It Works
          </Link>
          <Link
            href={demoHref}
            onClick={() => setIsMobileMenuOpen(false)}
            className="block text-gray-300 hover:text-purple-300 py-2 font-medium"
          >
            Sample Project
          </Link>
          <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
            <Link
              href={demoHref}
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-center text-gray-300 py-2 border border-white/10 rounded-lg"
            >
              {demoReady ? "Open your sample" : "Try the demo"}
            </Link>
            <Link
              href={signedIn ? "/dashboard" : "/login"}
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-center text-white bg-white/10 border border-purple-500/40 py-2.5 rounded-full"
            >
              {signedIn ? "Your projects" : "Sign in"}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
