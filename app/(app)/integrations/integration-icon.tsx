import { HandCoins, Users } from "lucide-react";

import type { IntegrationId } from "@/lib/integrations/registry";

/**
 * The integrations page's brand marks.
 *
 * Slack and Gmail embed their OFFICIAL multicolour logos verbatim (paths
 * fetched from devicon / Wikimedia Commons and inlined so the page makes no
 * external requests and works offline) — the four-colour Slack pinwheel and
 * Gmail's coloured M, exactly as people know them. The generic scaffolds —
 * CRM sync, Payments — have no single brand, so they take lucide glyphs in
 * the product violet. The rule: a real brand wears its own mark; everything
 * else wears the product's.
 *
 * Every glyph is decorative (aria-hidden) — the card's heading names the
 * integration, so the icons never carry information alone.
 */

const TILE = "flex size-9 shrink-0 items-center justify-center rounded-lg border";

const BRANDS: Record<
  IntegrationId,
  { tile: string; glyph: React.ReactNode }
> = {
  slack: {
    tile: "border-border bg-secondary",
    glyph: (
      <svg aria-hidden viewBox="0 0 128 128" className="size-5">
        <path
          d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0"
          fill="#36C5F0"
        />
        <path
          d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0"
          fill="#2EB67D"
        />
        <path
          d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0"
          fill="#ECB22E"
        />
        <path
          d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0"
          fill="#E01E5A"
        />
      </svg>
    ),
  },
  gmail: {
    tile: "border-border bg-secondary",
    glyph: (
      <svg aria-hidden viewBox="52 42 88 66" className="size-5">
        <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    ),
  },
  crm: {
    // Semantic primary tokens, not raw purple-300 — the raw shade computed
    // 1.56:1 against the light background and vanished in light mode.
    tile: "border-primary/25 bg-primary/10 text-primary",
    glyph: <Users aria-hidden className="size-[18px]" strokeWidth={1.75} />,
  },
  payments: {
    tile: "border-primary/25 bg-primary/10 text-primary",
    glyph: <HandCoins aria-hidden className="size-[18px]" strokeWidth={1.75} />,
  },
};

export function IntegrationIcon({ id }: { id: IntegrationId }) {
  const brand = BRANDS[id];
  return <span className={`${TILE} ${brand.tile}`}>{brand.glyph}</span>;
}
