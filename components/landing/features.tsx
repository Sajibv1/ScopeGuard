"use client";

import {
  FileSearch,
  DollarSign,
  MessagesSquare,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Reveal } from "@/components/landing/reveal";

/*
 * The features grid from the DOnttakeeverythng design: cards stagger in on
 * scroll, then reward hover with a lift, a shine sweep, a top glow, and the
 * growing gradient line along the bottom. Icons were swapped from
 * @heroicons/react (not a dependency of this app) to the lucide equivalents.
 */
const features: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: FileSearch,
    title: "Evidence-Based Analysis",
    description:
      "Quotes exact clauses from your original contract instead of guessing scope boundaries.",
  },
  {
    icon: DollarSign,
    title: "Smart Change Pricing",
    description:
      "Calculates fair pricing adjustments based on additional effort and feature complexity.",
  },
  {
    icon: MessagesSquare,
    title: "Instant Professional Replies",
    description:
      "Generates polite, firm, and evidence-backed client responses in seconds.",
  },
  {
    icon: ShieldCheck,
    title: "Scope Creep Protection",
    description:
      "Prevents unpaid work by identifying subtle feature requests before you start building.",
  },
];

export function LandingFeatures() {
  return (
    <section
      id="features"
      className="relative py-24 bg-[#05030A] text-white overflow-hidden"
    >
      {/* Background Subtle Glows */}
      <div className="absolute inset-0 pointer-events-none -z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-purple-900/10 blur-[130px] rounded-full" />
      </div>

      <div className="relative max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 z-10">
        {/* Section Header */}
        <Reveal className="mb-16">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-xs uppercase tracking-widest font-semibold text-purple-400 mb-3">
              Why ScopeGuard
            </h2>
            <p className="text-2xl sm:text-4xl font-semibold text-white tracking-tight">
              Everything you need to handle scope creep like a pro.
            </p>
          </div>
        </Reveal>

        {/* Feature Cards Grid — staggered reveal, one card after another */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <Reveal key={feature.title} delay={idx * 150} className="h-full">
                <div
                  className="
                    group relative h-full p-6 rounded-2xl
                    border border-white/10 bg-white/[0.02]
                    backdrop-blur-md overflow-hidden
                    flex flex-col justify-between

                    transition-all duration-500 ease-out
                    hover:-translate-y-2
                    hover:border-purple-400/40
                    hover:bg-white/[0.05]
                    hover:shadow-[0_20px_60px_rgba(168,85,247,0.18)]
                  "
                >
                  {/* Moving shine */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent skew-x-12 pointer-events-none" />

                  {/* Top glow */}
                  <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-32 h-32 bg-purple-500/20 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                  <div>
                    {/* Icon Wrapper */}
                    <div
                      className="
                        w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20
                        flex items-center justify-center mb-5

                        transition-all duration-500 ease-out
                        group-hover:scale-110 group-hover:rotate-6
                        group-hover:bg-purple-500/20 group-hover:border-purple-400/40
                        group-hover:shadow-[0_0_25px_rgba(168,85,247,0.25)]
                      "
                    >
                      <Icon
                        className="
                          w-5 h-5 text-purple-300
                          transition-all duration-500
                          group-hover:text-purple-200
                        "
                      />
                    </div>

                    {/* Title */}
                    <h3
                      className="
                        text-base font-semibold text-white mb-2
                        transition-transform duration-500
                        group-hover:translate-x-1
                      "
                    >
                      {feature.title}
                    </h3>

                    {/* Description */}
                    <p
                      className="
                        text-xs text-gray-400 leading-relaxed
                        transition-colors duration-500
                        group-hover:text-gray-300
                      "
                    >
                      {feature.description}
                    </p>
                  </div>

                  {/* Bottom animated line */}
                  <div className="mt-6 relative h-[2px] w-full overflow-hidden rounded-full bg-white/5">
                    <div
                      className="
                        absolute left-0 top-0 h-full w-0 rounded-full
                        bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500

                        group-hover:w-full
                        transition-all duration-700 ease-out

                        shadow-[0_0_12px_rgba(168,85,247,0.7)]
                      "
                    />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
