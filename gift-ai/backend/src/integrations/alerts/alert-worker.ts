import { logger } from "../../logger.js";
import { ropAlertsConfig, ropAlertsEnabled } from "./alerts-config.js";
import { isWithinRopAlertWindow } from "./alert-hours.js";
import { maybeSendDailyDigest } from "./daily-digest.js";
import { processDueWatches, scanUnpaidInvoices, scanUnprocessedLeads, scanRecentlyLostDeals } from "./rop-alerts.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running || !ropAlertsEnabled()) return;
  running = true;

  try {
    const cfg = ropAlertsConfig();
    await maybeSendDailyDigest(cfg);

    if (!isWithinRopAlertWindow(cfg)) return;

    const fired = await processDueWatches(cfg);
    await scanUnprocessedLeads(cfg);
    await scanUnpaidInvoices(cfg);
    await scanRecentlyLostDeals(cfg);
    if (fired > 0) {
      logger.info("ROP alert watches processed", { fired });
    }
  } catch (error) {
    logger.error("ROP alerts worker tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

export function startRopAlertsWorker(): void {
  if (!ropAlertsEnabled()) {
    logger.info("ROP alerts worker disabled");
    return;
  }

  const cfg = ropAlertsConfig();
  const intervalMs = Math.max(15, cfg.pollIntervalSec) * 1000;

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();
  logger.info("ROP alerts worker started", { intervalSec: cfg.pollIntervalSec });
}

export function stopRopAlertsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
