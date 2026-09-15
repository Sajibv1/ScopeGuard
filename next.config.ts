import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev server is sometimes reached from another device on the LAN, and the
  // Slack OAuth flow runs on the hosts-file domain (see README) — both must
  // be allowed or Next blocks /_next/* dev resources (JS included) for them,
  // which silently kills every button on the page.
  allowedDevOrigins: ["192.168.0.102", "scopeguard.test", "localhost"],
  /*
   * pdfkit reads its base-14 font metrics (.afm) from disk at runtime, so it
   * must stay a real Node module rather than being bundled — webpack would
   * rewrite the paths and the fonts would not resolve.
   *
   * @napi-rs/canvas is a native addon and tesseract.js ships workers and WASM
   * resolved at runtime — neither can be folded into a server bundle.
   */
  serverExternalPackages: ["pdfkit", "@napi-rs/canvas", "tesseract.js"],
  experimental: {
    // Scope documents can be long; allow a generous server action body.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
