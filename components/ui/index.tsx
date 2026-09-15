/**
 * Shared UI primitives — the ScopeGuard component layer over shadcn/ui.
 *
 * This barrel preserves the public API of the original components/ui.tsx
 * (same export names, same props) so every surface restyles through it; the
 * shadcn primitives it builds on live in sibling files (button.tsx, …).
 *
 * The look is the landing page's "Cosmic Violet": glass cards on the night
 * ground with hairline borders and a faint violet glow; the primary button
 * is the landing CTA (see button.tsx / .btn-cosmic).
 *
 * Assessment labels never rely on colour alone (plan §3 interaction
 * principles): each carries a distinct glyph and its full text, so the
 * distinction survives greyscale printing and colour vision deficiency.
 */

import Link from "next/link";
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "cn";

import {
  ASSESSMENT_LABEL_TEXT,
  REQUEST_STATUS_TEXT,
  type AssessmentLabel,
  type RequestStatus,
} from "@/lib/types";

import { Button as ShadcnButton, type buttonVariants } from "./button";

type ButtonSize = VariantProps<typeof buttonVariants>["size"];

// ── Assessment label ────────────────────────────────────────────────────────

const LABEL_STYLES: Record<AssessmentLabel, { className: string; glyph: string }> = {
  included: {
    className: "bg-included-bg text-included-fg border-included-br",
    glyph: "✓",
  },
  potentially_additional: {
    className: "bg-additional-bg text-additional-fg border-additional-br",
    glyph: "+",
  },
  needs_clarification: {
    className: "bg-clarify-bg text-clarify-fg border-clarify-br",
    glyph: "?",
  },
};

export function LabelBadge({
  label,
  size = "md",
}: {
  label: AssessmentLabel;
  size?: "sm" | "md";
}) {
  const style = LABEL_STYLES[label];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-[13px]",
        style.className,
      )}
    >
      <span aria-hidden className="font-bold">
        {style.glyph}
      </span>
      {ASSESSMENT_LABEL_TEXT[label]}
    </span>
  );
}

// ── Change-request status badge ─────────────────────────────────────────────

const STATUS_STYLES: Record<RequestStatus, string> = {
  draft: "bg-status-draft-bg text-status-draft-fg border-status-draft-br",
  ready: "bg-status-ready-bg text-status-ready-fg border-status-ready-br",
  sent: "bg-status-sent-bg text-status-sent-fg border-status-sent-br",
  approved: "bg-status-approved-bg text-status-approved-fg border-status-approved-br",
  declined: "bg-status-declined-bg text-status-declined-fg border-status-declined-br",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {REQUEST_STATUS_TEXT[status]}
    </span>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** Our variant names mapped onto the shadcn button. */
const VARIANT_MAP: Record<
  ButtonVariant,
  { variant: "default" | "secondary" | "ghost" | "outline"; extra?: string }
> = {
  primary: { variant: "default" },
  secondary: { variant: "secondary" },
  ghost: { variant: "ghost" },
  // Danger is an outline red, so the oxblood primary stays the only filled
  // red-family control on screen.
  danger: {
    variant: "outline",
    extra: "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
  },
};

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const mapped = VARIANT_MAP[variant];
  return (
    <ShadcnButton
      variant={mapped.variant}
      size={size}
      className={cn(mapped.extra, className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "default",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const mapped = VARIANT_MAP[variant];
  return (
    <ShadcnButton
      asChild
      variant={mapped.variant}
      size={size}
      className={cn(mapped.extra, className)}
    >
      <Link {...props} />
    </ShadcnButton>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[0_0_35px_rgb(124_58_237/0.07)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{eyebrow}</div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// ── Notices ─────────────────────────────────────────────────────────────────

type NoticeTone = "info" | "warning" | "danger" | "success";

const NOTICE_STYLES: Record<NoticeTone, string> = {
  info: "border-notice-info-br bg-notice-info-bg text-notice-info-fg",
  warning: "border-notice-warn-br bg-notice-warn-bg text-notice-warn-fg",
  danger: "border-notice-danger-br bg-notice-danger-bg text-notice-danger-fg",
  success: "border-notice-success-br bg-notice-success-bg text-notice-success-fg",
};

const NOTICE_ICONS: Record<NoticeTone, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CheckCircle2,
};

export function Notice({
  tone = "info",
  title,
  children,
  className = "",
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div
      // Errors must interrupt (role=alert); successes may be announced
      // politely once they appear. Info/warning notices are usually static
      // page copy, so announcing them on load would be noise.
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "success" ? "polite" : undefined}
      className={cn(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-sm",
        NOTICE_STYLES[tone],
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shown wherever model output appears while no API key is configured, so a
 * fixture result is never mistaken for a live model's judgement.
 */
export function FixtureBanner() {
  return (
    <Notice tone="warning" title="Fixture mode — no live model">
      <p>
        No <code className="rounded bg-warn/15 px-1 py-0.5 text-xs">OPENAI_API_KEY</code> is
        configured, so these results come from a deterministic rule-based stand-in rather than a
        language model. Every citation shown still passes the same verification as live output.
      </p>
    </Notice>
  );
}

/**
 * The plan requires a user-visible explanation that document text is sent to
 * the AI provider. It appears at the point of sending, not buried in a policy.
 */
export function ProviderNotice({ model }: { model: string }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Analysing sends your scope document and the client message to OpenAI ({model}) for
      processing. Do not paste material you are not permitted to share.
    </p>
  );
}

/**
 * Provenance caption for OCR-derived baselines. One wording everywhere the
 * transcription can be quoted from — the guarantee must not drift by surface.
 */
export function OcrCaption({ confidence }: { confidence: number }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Machine-transcribed (OCR, {confidence}% confidence), reviewed by you — quotes cite this
      transcription, not the original document.
    </p>
  );
}

/**
 * Provenance caption for call-transcript baselines (plan §10). Same rule as
 * OCR, stated for speech: a verified quote proves something was said in the
 * call, never that it was signed.
 */
export function TranscriptCaption() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Transcript of a call, reviewed by you — evidence cites what was said at a timestamp, not
      signed contract text.
    </p>
  );
}

export function RecapCaption() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Your notes from a call, not an agreement — every item below is unverified until the client
      confirms a recap.
    </p>
  );
}

// ── Form fields ─────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const errorId = useId();
  // Connect a single-element control to its inline error so screen readers
  // announce it on focus and aria-invalid marks the field without relying on
  // colour alone. Field is only ever rendered inside client form components.
  const control =
    error && isValidElement(children)
      ? cloneElement(
          children as ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>,
          { "aria-describedby": errorId, "aria-invalid": true },
        )
      : children;
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="text-xs font-normal text-muted-foreground">required</span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">optional</span>
        )}
      </span>
      {control}
      {hint && !error ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
      {error ? (
        <span id={errorId} className="mt-1 block text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass = cn(
  "flex h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-sm",
  "placeholder:text-muted-foreground dark:bg-input/30",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const textareaClass = cn(inputClass, "h-auto min-h-20 resize-y px-3 py-2 leading-relaxed");
