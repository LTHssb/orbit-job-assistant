import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: appRoot,
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  // Chromium ships a compressed executable under its package directory. Keep
  // both runtime packages external so Next/Vercel does not relocate the bin
  // directory into an incomplete traced bundle.
  serverExternalPackages: ["@napi-rs/canvas", "@sparticuz/chromium", "pdf-parse", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/sources/import": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/sources/tasks": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/cron/sources": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/cron/source": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    // pdf-parse loads the PDF.js worker dynamically at runtime. Next's
    // output tracing cannot infer that import, so include both the legacy
    // Node build and its worker explicitly in the resume parse function.
    "/api/resumes/parse": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/pdfjs-dist/build/**/*",
    ],
  },
};

export default nextConfig;
