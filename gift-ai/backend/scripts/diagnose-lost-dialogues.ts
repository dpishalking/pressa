import { buildLostDialoguesList, DEFAULT_THRESHOLDS } from "../src/integrations/crm/bitrix-action-lists.js";
import { fetchSessionChat, listOpenLineSessions } from "../src/integrations/crm/bitrix-openlines.js";
import {
  clientMessageNeedsManagerResponse,
  isLostDialogue,
} from "../src/integrations/crm/lost-dialogue.js";
import {
  isOpenLineSessionAlertable,
  isOpenLineSessionOpen,
  resolveSessionCrmContext,
  SessionCrmCache,
} from "../src/integrations/crm/session-crm-status.js";

async function main(): Promise<void> {
  const rows = await buildLostDialoguesList({});
  console.log(`\n=== ${rows.length} lost dialogues in export ===\n`);

  const sessions = await listOpenLineSessions({
    from: new Date(Date.now() - DEFAULT_THRESHOLDS.lostDialogueWindowDays * 86_400_000)
      .toISOString()
      .slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const crmCache = new SessionCrmCache();

  for (const row of rows) {
    const session = byId.get(row.sessionId);
    console.log("─".repeat(80));
    console.log(
      `#${row.sessionId} | ${row.channel} | ${row.clientLabel} | deal=${row.dealId || "—"} lead=${row.leadId || "—"} | ${row.waitingHours}h`,
    );
    console.log(`Sheet last msg: ${row.lastClientMessage.slice(0, 120)}`);

    if (!session) {
      console.log("VERDICT: ⚠ session not in window (stale export?)");
      continue;
    }

    const stats = await fetchSessionChat(session);
    const clientMsgs = stats.messages.filter((m) => m.author === "client");
    const managerMsgs = stats.messages.filter((m) => m.author === "manager");
    const check = isLostDialogue({
      clientMessages: clientMsgs,
      managerMessages: managerMsgs,
      minWaitingHours: DEFAULT_THRESHOLDS.lostDialogueMinHours,
    });

    const open = isOpenLineSessionOpen(session);
    const alertable = await isOpenLineSessionAlertable(session, crmCache);
    const ctx = await resolveSessionCrmContext(session, crmCache);

    const lastClient = clientMsgs.at(-1);
    const lastManager = managerMsgs.at(-1);
    const lastAny = stats.messages.filter((m) => m.author !== "system").at(-1);

    console.log(`Chat open=${open} crm_alertable=${alertable}`);
    console.log(`Last client [${lastClient?.date ?? "—"}]: ${JSON.stringify(lastClient?.text?.slice(0, 150) ?? "—")}`);
    console.log(`Last manager [${lastManager?.date ?? "—"}]: ${JSON.stringify(lastManager?.text?.slice(0, 150) ?? "—")}`);
    console.log(`Last non-system author=${lastAny?.author}: ${JSON.stringify(lastAny?.text?.slice(0, 100) ?? "—")}`);

    const needsResponse = lastClient ? clientMessageNeedsManagerResponse(lastClient.text) : false;
    console.log(`needsResponse=${needsResponse} isLost=${check.lost} waiting=${check.waitingHours}h`);

    let verdict: string;
    if (!check.lost) {
      if (lastAny?.author === "manager") {
        verdict = "❌ FALSE: менеджер ответил последним";
      } else if (!needsResponse) {
        verdict = "❌ FALSE: последнее сообщение клиента не требует ответа";
      } else if (check.waitingHours < DEFAULT_THRESHOLDS.lostDialogueMinHours) {
        verdict = "❌ FALSE: ещё не прошло 2ч";
      } else {
        verdict = "❌ FALSE: другое";
      }
    } else if (!open) {
      verdict = "⚠ TRUE по логике, но чат закрыт";
    } else if (!alertable) {
      verdict = "⚠ TRUE по логике, но CRM закрыта";
    } else {
      verdict = "✅ TRUE: клиент ждёт ответа на вопрос";
    }
    console.log(`VERDICT: ${verdict}`);

    console.log("Tail (last 6 non-system):");
    for (const m of stats.messages.filter((x) => x.author !== "system").slice(-6)) {
      console.log(`  [${m.author}] ${m.date.slice(0, 16)} ${m.text.slice(0, 100).replace(/\n/g, " ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
