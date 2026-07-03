import { ropAlertsConfig, ropAlertsEnabled } from "../src/integrations/alerts/alerts-config.js";
import { LEAD_IN_WORK_STATUS_ID, leadTakenInWorkAt } from "../src/integrations/crm/lead-in-work.js";
import { LEAD_NEW_STATUS_ID, leadNeedsNoResponseAlert } from "../src/integrations/crm/lead-no-response.js";
import {
  listBitrixLeads,
  listBitrixStatusLabels,
  resolveBitrixUserNames,
} from "../src/integrations/crm/bitrix-client.js";
import { findLatestOpenLineSessionForOwners, fetchSessionChat } from "../src/integrations/crm/bitrix-openlines.js";

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function minutesBetween(fromIso: string): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((Date.now() - from) / 60_000));
}

function hoursBetween(fromIso: string): number {
  return Math.floor(minutesBetween(fromIso) / 60);
}

async function main(): Promise<void> {
  if (!ropAlertsEnabled()) {
    console.error("ROP alerts not enabled");
    process.exit(1);
  }

  const cfg = ropAlertsConfig();
  const statusLabels = await listBitrixStatusLabels("STATUS");

  console.log("\n=== Lead statuses in Bitrix ===");
  for (const [id, name] of statusLabels) {
    console.log(`  ${id}: ${name}`);
  }

  const staleCutoff = hoursAgoIso(cfg.leadNoResponseMinutes / 60);
  const filter: Record<string, unknown> = {
    STATUS_ID: LEAD_NEW_STATUS_ID,
    STATUS_SEMANTIC_ID: "P",
    "<DATE_CREATE": staleCutoff,
  };
  if (cfg.leadMaxAgeDays > 0) {
    filter[">=DATE_CREATE"] = daysAgoIso(cfg.leadMaxAgeDays);
  }

  const leads = await listBitrixLeads(filter, [
    "STATUS_ID",
    "STATUS_SEMANTIC_ID",
    "ASSIGNED_BY_ID",
    "DATE_CREATE",
    "DATE_MODIFY",
    "TITLE",
    "NAME",
    "LAST_NAME",
  ]);

  console.log(`\n=== Bot would alert on ${leads.length} leads ===`);
  console.log(`Threshold: ${cfg.leadNoResponseMinutes} min since DATE_CREATE, max age ${cfg.leadMaxAgeDays}d\n`);

  for (const lead of leads) {
    const leadId = String(lead.ID);
    const statusId = lead.STATUS_ID ?? "";
    const statusName = statusLabels.get(statusId) ?? statusId;
    const takenAt = await leadTakenInWorkAt(leadId);
    const managerIds = await resolveBitrixUserNames([String(lead.ASSIGNED_BY_ID ?? "")]);
    const manager = managerIds.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? "—";

    const session = await findLatestOpenLineSessionForOwners([{ ownerTypeId: "1", ownerId: leadId }]);
    let chatSummary = "нет чата";
    let managerRepliedInChat = false;
    let instagramComment = false;
    if (session) {
      const stats = await fetchSessionChat(session);
      instagramComment = stats.instagramPostComment;
      const clientMsgs = stats.messages.filter((m) => m.author === "client");
      const managerMsgs = stats.messages.filter((m) => m.author === "manager");
      const lastClient = clientMsgs.at(-1);
      const lastManager = managerMsgs.at(-1);
      managerRepliedInChat = managerMsgs.length > 0;
      chatSummary = `сессия ${session.sessionId}, client=${clientMsgs.length} mgr=${managerMsgs.length}`;
      if (lastManager) chatSummary += `, посл. менеджер ${lastManager.date.slice(0, 16)}`;
      if (lastClient) chatSummary += `, посл. клиент ${lastClient.date.slice(0, 16)}`;
    }

    const inWork = statusId === LEAD_IN_WORK_STATUS_ID;
    const waitFromCreate = minutesBetween(lead.DATE_CREATE ?? "");
    const waitInWork = takenAt ? hoursBetween(takenAt) : 0;

    const check = await leadNeedsNoResponseAlert(leadId, cfg.leadNoResponseMinutes);

    let verdict: string;
    if (!check.alert && check.skipReason === "instagram_comment") {
      verdict = "❌ SKIP: комментарий Instagram без запроса о покупке";
    } else if (!check.alert && statusId !== LEAD_NEW_STATUS_ID) {
      verdict = `❌ SKIP: статус «${statusName}» — не NEW`;
    } else if (!check.alert && managerRepliedInChat) {
      verdict = "❌ SKIP: менеджер уже ответил в чате";
    } else if (check.alert) {
      verdict = "✅ алерт уместен";
    } else {
      verdict = "❌ SKIP: ещё не прошло порога или другая причина";
    }

    console.log("─".repeat(70));
    console.log(`#${leadId} | ${lead.TITLE ?? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(" ")}`);
    console.log(`Статус: ${statusName} (${statusId}) | Менеджер: ${manager}`);
    console.log(`Создан: ${lead.DATE_CREATE?.slice(0, 16)} (${waitFromCreate} мин назад)`);
    if (takenAt) console.log(`В работе с: ${takenAt.slice(0, 16)} (${waitInWork}ч)`);
    console.log(`Чат: ${chatSummary}${instagramComment ? " [комментарий к посту IG]" : ""}`);
    console.log(`VERDICT: ${verdict}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
