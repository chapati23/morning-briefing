/**
 * Cloud Run HTTP Entry Point
 *
 * Exposes endpoints for:
 * - POST /briefing - Trigger a briefing (called by Cloud Scheduler)
 * - GET /health - Health check
 * - POST /webhook/things - Receive Things todos from Apple Shortcut
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

    // Things webhook (for Apple Shortcut)
    // Currently logs received todos; GCS storage deferred until webhook is actively used
    if (url.pathname === "/webhook/things" && method === "POST") {
      try {
        const body = await req.json();
        console.log("[webhook] Received Things todos:", JSON.stringify(body));
        return Response.json({ success: true, received: true });
      } catch (error) {
        console.error("[webhook] Failed to process Things webhook:", error);
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
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
console.log(`  POST /webhook/things - Receive Things todos`);
