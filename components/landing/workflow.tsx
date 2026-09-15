"use client";

import { useEffect, useState } from "react";
import { Reveal } from "@/components/landing/reveal";

/*
 * The workflow section from the DOnttakeeverythng design, adapted: the
 * right side shows all three steps at once, stacked as one mock window —
 * baseline, incoming request, response — so nothing is hidden behind a
 * click. The left cards describe the steps. Content unchanged — it already
 * describes ScopeGuard's real three-step flow with fictional example text.
 */
const steps = [
  {
    id: "01",
    title: "Upload Contract or SOW",
    subtitle: "Paste your scope text",
    description:
      "Paste your agreement, scope document, or contract text that defines what was originally promised.",
    previewContent: {
      type: "contract",
      heading: "Baseline saved",
      text: "Section 3.1 • 5 responsive pages included. Advanced animations and database setup excluded.",
      tag: "Agreement",
    },
  },
  {
    id: "02",
    title: "Paste Client Request",
    subtitle: "Input raw client messages",
    description:
      "Add the exact email, text, or Slack message your client sent. ScopeGuard automatically isolates actionable requests.",
    previewContent: {
      type: "request",
      heading: "New request read",
      text: "Add interactive database models and a real-time animation preview to the workflow.",
      tag: "Client message",
    },
  },
  {
    id: "03",
    title: "Generate Evidence & Quote",
    subtitle: "Instant client response",
    description:
      "Get precise contract citations, estimated additional cost, and a ready-to-send polite response.",
    previewContent: {
      type: "result",
      heading: "Change request ready",
      text: "Cite Section 3.1, add $850, and allow 3 more business days.",
      tag: "Out of scope",
    },
  },
];

type WorkflowCase = {
  baseline: {
    heading: string;
    tag: string;
    text: string;
  };
  request: string;
  checking: string;
  result: {
    heading: string;
    tag: string;
    text: string;
  };
};

const workflowCases: readonly WorkflowCase[] = [
  {
    baseline: {
      heading: "Baseline saved",
      tag: "Agreement",
      text: "Section 3.1 • 5 responsive pages included. Database setup and advanced animations excluded.",
    },
    request: "Could you add interactive database models and a real-time animation preview?",
    checking: "Matches two excluded deliverables in Section 3.1…",
    result: {
      heading: "Change request drafted",
      tag: "Out of scope",
      text: "Add $850 and 3 business days. The reply cites Section 3.1.",
    },
  },
  {
    baseline: {
      heading: "Baseline saved",
      tag: "Agreement",
      text: "Section 2.2 • One launch review is included; its date can be agreed during delivery.",
    },
    request: "Can we move our included launch review from Thursday to Friday?",
    checking: "Checking the request against the delivery allowance…",
    result: {
      heading: "Already included",
      tag: "No extra quote",
      text: "Confirm the Friday slot. This stays within the existing agreement.",
    },
  },
  {
    baseline: {
      heading: "Baseline saved",
      tag: "Agreement",
      text: "Section 1.4 • English copy is supplied by the client. Translation is not specified.",
    },
    request: "Could you also provide Spanish copy for every page before launch?",
    checking: "The agreement does not define translation ownership…",
    result: {
      heading: "Clarification needed",
      tag: "Needs review",
      text: "Ask who supplies translations before estimating the additional work.",
    },
  },
];

type RunStage = "baseline" | "message" | "checking" | "ready";

const stageLabels: Record<RunStage, string> = {
  baseline: "Agreement imported",
  message: "New message received",
  checking: "Checking the agreement",
  ready: "Change request drafted",
};

export function LandingWorkflow() {
  const [runStage, setRunStage] = useState<RunStage>("baseline");
  const [typedMessage, setTypedMessage] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [caseIndex, setCaseIndex] = useState(0);
  const activeCase = workflowCases[caseIndex]!;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(motionQuery.matches);

    updatePreference();
    motionQuery.addEventListener("change", updatePreference);
    return () => motionQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setCaseIndex(0);
      setTypedMessage(workflowCases[0]!.request);
      setRunStage("ready");
      return;
    }

    let typingTimer: number | undefined;
    let restartTimer: number | undefined;
    const timers = new Set<number>();
    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    };

    const playRun = (nextCaseIndex: number) => {
      const caseForRun = workflowCases[nextCaseIndex]!;
      setCaseIndex(nextCaseIndex);
      setRunStage("baseline");
      setTypedMessage("");

      later(() => setRunStage("message"), 650);
      later(() => {
        typingTimer = window.setInterval(() => {
          setTypedMessage((current) => {
            if (current.length >= caseForRun.request.length) {
              if (typingTimer !== undefined) window.clearInterval(typingTimer);
              return current;
            }
            return caseForRun.request.slice(0, current.length + 1);
          });
        }, 22);
      }, 850);
      later(() => {
        if (typingTimer !== undefined) window.clearInterval(typingTimer);
        setTypedMessage(caseForRun.request);
        setRunStage("checking");
      }, 2850);
      later(() => setRunStage("ready"), 3900);
      restartTimer = window.setTimeout(
        () => playRun((nextCaseIndex + 1) % workflowCases.length),
        7200,
      );
    };

    playRun(0);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (typingTimer !== undefined) window.clearInterval(typingTimer);
      if (restartTimer !== undefined) window.clearTimeout(restartTimer);
    };
  }, [reducedMotion]);

  return (
    <section
      id="how-it-works"
      className="relative overflow-x-clip border-t border-white/10 bg-[#05030A] py-20 sm:py-28 text-white"
    >
      {/* Background Radial Lights */}
      <div className="absolute top-1/3 left-1/4 w-[600px] h-[400px] bg-purple-900/15 blur-[150px] rounded-full pointer-events-none -z-0" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[300px] bg-indigo-900/10 blur-[130px] rounded-full pointer-events-none -z-0" />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 z-10">
        {/* Header Section — long cinematic reveal on scroll */}
        <Reveal duration={1.2}>
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 font-mono text-xs tracking-wider mb-4">
                HOW IT WORKS
              </span>
              <h2 className="text-3xl sm:text-5xl font-semibold text-white tracking-tight">
                From raw message to <br className="hidden sm:block" />
                <span className="bg-gradient-to-r from-purple-300 via-indigo-200 to-pink-300 bg-clip-text text-transparent">
                  proof-backed response.
                </span>
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-400 max-w-md leading-relaxed">
              ScopeGuard parses the baseline agreement, reads the client&rsquo;s
              message against it, and turns scope creep into additional
              revenue.
            </p>
          </div>
        </Reveal>

        {/* Main Container */}
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
          {/* Left Column: Step Descriptions */}
          <div className="flex flex-col justify-between gap-3 sm:gap-4">
            {steps.map((step) => (
              <div
                key={step.id}
                className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition-colors duration-300 hover:border-white/20 hover:bg-white/[0.045] sm:p-6"
              >
                {/* Left accent bar */}
                <span className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-400 to-pink-500" />

                <div className="mb-2 flex items-start justify-between gap-3">
                  <span className="font-mono text-sm font-bold text-purple-400">
                    {step.id}
                  </span>
                  <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-2.5 py-0.5 text-right font-mono text-[10px] leading-relaxed text-purple-200">
                    {step.subtitle}
                  </span>
                </div>

                <h3 className="text-lg font-semibold text-white mb-2">
                  {step.title}
                </h3>

                <p className="text-xs text-gray-400 leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>

          {/* Right Column: the same three stages, shown as one compact run. */}
          <div className="min-w-0">
            <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0A0712] p-4 shadow-2xl sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 px-1 pb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">One request, checked end to end</p>
                  <p className="text-xs text-gray-500">Rotating through three sample cases</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block font-mono text-[10px] text-purple-300">Case {caseIndex + 1} of {workflowCases.length}</span>
                  <span className="text-[10px] text-gray-500">{stageLabels[runStage]}</span>
                </div>
              </div>

              <ol className="flex flex-1 flex-col justify-between gap-2">
                {steps.map((step, index) => (
                  <li key={step.id} className="relative min-w-0">
                    <div
                      className={`flex min-w-0 gap-3 rounded-xl border p-3 transition-[border-color,background-color,opacity,transform] duration-500 sm:p-4 ${
                        (index === 0 && runStage === "baseline") ||
                        (index === 1 && runStage === "message") ||
                        (index === 2 && (runStage === "checking" || runStage === "ready"))
                          ? "border-purple-400/40 bg-purple-500/[0.08]"
                          : "border-white/10 bg-white/[0.025]"
                      } ${
                        (index === 1 && runStage === "baseline") ||
                        (index === 2 && (runStage === "baseline" || runStage === "message"))
                          ? "translate-y-1 opacity-55"
                          : "translate-y-0 opacity-100"
                      }`}
                    >
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${
                        (index === 0 && runStage !== "baseline") ||
                        (index === 1 && (runStage === "checking" || runStage === "ready")) ||
                        (index === 2 && runStage === "ready")
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                          : "border-purple-400/30 bg-purple-500/10 text-purple-300"
                      }`}>
                        {step.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {index === 1 ? (
                            <>
                              <span className="flex size-4 items-center justify-center rounded-full bg-pink-400/15 text-[8px] font-semibold text-pink-200">C</span>
                              <h4 className="text-sm font-semibold text-white">Client</h4>
                              <span className="text-[10px] text-gray-500">just now</span>
                            </>
                          ) : (
                            <>
                              <h4 className="text-sm font-semibold text-white">
                                {index === 0 ? activeCase.baseline.heading : activeCase.result.heading}
                              </h4>
                              <span className="font-mono text-[10px] text-purple-300/80">
                                {index === 0 ? activeCase.baseline.tag : activeCase.result.tag}
                              </span>
                            </>
                          )}
                        </div>
                        {index === 1 ? (
                          <div className="rounded-lg border border-white/10 bg-[#15101f] px-3 py-2 text-xs leading-relaxed text-gray-300">
                            {runStage === "baseline" ? "Client is typing…" : typedMessage}
                            {runStage === "message" && typedMessage.length < activeCase.request.length && (
                              <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-purple-300 align-[-2px]" aria-hidden="true" />
                            )}
                          </div>
                        ) : index === 2 && runStage === "checking" ? (
                          <div className="flex items-center gap-2 text-xs leading-relaxed text-purple-200">
                            <span className="size-2 animate-pulse rounded-full bg-purple-300" aria-hidden="true" />
                            {activeCase.checking}
                          </div>
                        ) : (
                          <p className="break-words text-xs leading-relaxed text-gray-400">
                            {index === 0 ? activeCase.baseline.text : activeCase.result.text}
                          </p>
                        )}
                      </div>
                    </div>
                    {index < steps.length - 1 && (
                      <div className="ml-3.5 h-2 border-l border-dashed border-purple-400/30" aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ol>
              <p className="sr-only" aria-live="polite">{stageLabels[runStage]}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
