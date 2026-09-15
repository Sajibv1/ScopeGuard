"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Scroll-reveal wrapper reproducing the reference's framer-motion
 * whileInView entrances: fade up once, when the element enters the
 * viewport. `delay` staggers sibling reveals (via the --reveal-delay CSS
 * variable, so the stagger survives reduced-motion); `duration` lets a
 * section ask for the slower cinematic reveal.
 */
export function Reveal({
  children,
  delay = 0,
  duration = 0.6,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ "--reveal-delay": `${delay}ms`, transitionDuration: `${duration}s` } as CSSProperties}
      className={`landing-reveal ${visible ? "is-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
