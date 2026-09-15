"use client";

import { useEffect, useRef } from "react";

import { buildSegments, type Highlight } from "@/lib/highlight";
import type { Locator } from "@/lib/types";

export type { Highlight };

/**
 * Renders the source document with evidence spans highlighted.
 *
 * The segmentation logic lives in lib/highlight.ts; this component only turns
 * segments into markup and manages focus.
 */
export function SourceViewer({
  text,
  locators,
  highlights,
  activeId,
  onSelectHighlight,
  className = "",
}: {
  text: string;
  locators?: Locator[];
  highlights: Highlight[];
  activeId?: string | null;
  onSelectHighlight?: (id: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Bring the active evidence into view when the user clicks an item.
  useEffect(() => {
    if (!activeId || !containerRef.current) return;

    const target = containerRef.current.querySelector(`[data-highlight-id="${activeId}"]`);
    // JS smooth scrolling bypasses the CSS reduced-motion media query, so
    // honour the preference here.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeId]);

  const segments = buildSegments(text, highlights);

  return (
    <div ref={containerRef} className={`source-text ${className}`}>
      {segments.map((segment, index) => {
        if (segment.ids.length === 0) {
          return <span key={index}>{segment.text}</span>;
        }

        const isActive = activeId ? segment.ids.includes(activeId) : false;
        const primaryId = segment.ids[0]!;

        return (
          <mark
            key={index}
            data-highlight-id={primaryId}
            data-active={isActive}
            className="evidence-mark"
            onClick={onSelectHighlight ? () => onSelectHighlight(primaryId) : undefined}
            role={onSelectHighlight ? "button" : undefined}
            tabIndex={onSelectHighlight ? 0 : undefined}
            onKeyDown={
              onSelectHighlight
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectHighlight(primaryId);
                    }
                  }
                : undefined
            }
            style={onSelectHighlight ? { cursor: "pointer" } : undefined}
          >
            {segment.text}
          </mark>
        );
      })}

      {locators && locators.length > 0 ? (
        <p className="mt-4 border-t border-border pt-3 font-sans text-xs text-muted-foreground">
          {locators.length} passage{locators.length === 1 ? "" : "s"} indexed for citation.
        </p>
      ) : null}
    </div>
  );
}
