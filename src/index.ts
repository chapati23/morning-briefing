/**
 * Cloud Run HTTP Entry Point
 *
 * Exposes endpoints for:
 * - POST /briefing - Trigger a briefing (called by Cloud Scheduler)
 * - GET /health - Health check
 */

// Load environment variables (for local dev; Cloud Run sets env vars directly)
import "./env";

import { getEnabledChannels } from "./channels";
import { config } from "./config";
import { runFullBriefing } from "./orchestrator";
import { getAllSources } from "./sources";

const cfg = config();

const server = Bun.serve({
  port: cfg.port,
  idleTimeout: 255, // Max allowed by Bun - briefing takes 30+ seconds with Puppeteer

  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // Health check
    if (url.pathname === "/health" && method === "GET") {
      return Response.json({
        status: "ok",
        timestamp: new Date().toISOString(),
      });
    }

    // Trigger briefing
    if (url.pathname === "/briefing" && method === "POST") {
      try {
        const sources = getAllSources();
        const channels = getEnabledChannels();

        if (sources.length === 0) {
          return Response.json(
            { error: "No sources configured" },
            { status: 400 },
          );
        }

        const briefing = await runFullBriefing(sources, channels);

        return Response.json({
          success: true,
          sections: briefing.sections.length,
          failures: briefing.failures.length,
          generatedAt: briefing.generatedAt.toISOString(),
        });
      } catch (error) {
        console.error("[server] Briefing failed:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500 },
        );
      }
    }

    // 404 for everything else
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`[server] Morning Briefing server running on port ${server.port}`);
console.log(`[server] Timezone: ${cfg.timezone}`);
console.log(`[server] Endpoints:`);
console.log(`  GET  /health         - Health check`);
console.log(`  POST /briefing       - Trigger briefing`);

// Warn about optional but expected configuration in production
if (
  process.env["NODE_ENV"] === "production" &&
  !process.env["GCS_DATA_BUCKET"]
) {
  console.warn(
    "[server] ⚠ GCS_DATA_BUCKET is not set. " +
      "App Store Rankings will work but without historical trend data. " +
      "Run `cd terraform && make plan && make apply` to provision the bucket.",
  );
}
