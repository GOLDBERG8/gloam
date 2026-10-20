import type { NextConfig } from "next";
import path from "node:path";

/**
 * When this package is the Vercel Root Directory (`app`), keep tracing
 * inside the monorepo without pointing output at a broken `.next` path.
 */
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Compile the workspace SDK from source so there is no build-order dependency
  // (Vercel builds only `app`). @gloamtrade/sdk exports TS source; Next transpiles it.
  transpilePackages: ["@gloamtrade/sdk"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // Every response gets the basics. Framing is refused everywhere but the pitch
  // deck (a static page that may be embedded). The CSP only covers framing,
  // plugins, <base> and form targets: script and connect sources are left open
  // so wallet connectors, the prover's WebAssembly and analytics keep working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
      {
        // proving files: a day in the browser and on the CDN. The integrity check
        // revalidates each one (lib/circuitArtifacts), so a regenerated file is still caught.
        source: "/circuits/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/((?!pitch).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
  // The pitch deck is one static page in public/pitch.
  async rewrites() {
    return [
      { source: "/pitch", destination: "/pitch/index.html" },
      { source: "/pitch/report", destination: "/pitch/report.html" },
    ];
  },
  webpack: (config) => {
    // WalletConnect optional deps — silence missing optional modules
    config.externals.push("pino-pretty", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    // @gloamtrade/sdk ships NodeNext TS source (".js" import specifiers). Let webpack
    // resolve those to the ".ts" sources when transpiling the workspace package.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
