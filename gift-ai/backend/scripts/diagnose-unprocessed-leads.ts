import { DEFAULT_THRESHOLDS } from "../src/integrations/crm/bitrix-action-lists.js";
import { listBitrixLeads, listBitrixStatusLabels, resolveBitrixUserNames } from "../src/integrations/crm/bitrix-client.js";
import { LEAD_IN_WORK_STATUS_ID } from "../src/integrations/crm/lead-in-work.js";
import { LEAD_NEW_STATUS_ID, leadNeedsNoResponseAlert } from "../src/integrations/crm/lead-no-response.js";
import { fetchSessionChat, findLatestOpenLineSessionForOwners } from "../src/integrations/crm/bitrix-openlines.js";

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function hoursBetween(fromIso: string): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((Date.now() - from) / 3_600_000));
}

async function main(): Promise<void> {
  const hours = DEFAULT_THRESHOLDS.leadUnprocessedHours;
  const statusLabels = await listBitrixStatusLabels("STATUS");

  const leads = await listBitrixLeads(
    { STATUS_SEMANTIC_ID: "P", "<DATE_CREATE": hoursAgoIso(hours) },
    ["STATUS_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "TITLE", "NAME", "LAST_NAME"],
  );

  console.log(`\n=== «Необработанные лиды» (текущая логика: semantic P, >${hours}ч от создания) ===`);
  console.log(`Всего строк: ${leads.length}\n`);

  let correctNew = 0;
  let falseInProcess = 0;
  let falseInProcessWithChat = 0;
  let falseNewWithChat = 0;

  for (const lead of leads) {
    const leadId = String(lead.ID);
    const statusId = lead.STATUS_ID ?? "";
    const statusName = statusLabels.get(statusId) ?? statusId;
    const isNew = statusId === LEAD_NEW_STATUS_ID;
    const isInWork = statusId === LEAD_IN_WORK_STATUS_ID;

    const session = await findLatestOpenLineSessionForOwners([{ ownerTypeId: "1", ownerId: leadId }]);
    let managerReplied = false;
    if (session) {
      const stats = await fetchSessionChat(session);
      managerReplied = stats.messages.some(
        (m) => m.author === "manager" && m.date >= (lead.DATE_CREATE ?? ""),
      );
    }

    const alertCheck = await leadNeedsNoResponseAlert(leadId, 0);

    let verdict: string;
    if (isInWork) {
      falseInProcess += 1;
      if (managerReplied) falseInProcessWithChat += 1;
      verdict = managerReplied
        ? "❌ IN_PROCESS + менеджер отвечал — не «необработанный»"
        : "❌ IN_PROCESS — уже в работе, не «необработанный»";
    } else if (isNew && managerReplied) {
      falseNewWithChat += 1;
      verdict = "⚠️ NEW, но менеджер уже писал в чат (статус не сменили)";
    } else if (isNew) {
      correctNew += 1;
      verdict = "✅ NEW без ответа — корректно";
    } else {
      verdict = `⚠️ статус «${statusName}» — не NEW и не IN_PROCESS`;
    }

    const managers = await resolveBitrixUserNames([String(lead.ASSIGNED_BY_ID ?? "")]);
    console.log("─".repeat(72));
    console.log(`#${leadId} | ${lead.TITLE ?? ""} | ${statusName} | ${hoursBetween(lead.DATE_CREATE ?? "")}ч`);
    console.log(`Менеджер: ${managers.get(String(lead.ASSIGNED_BY_ID ?? "")) ?? "—"} | чат: ${session ? "да" : "нет"} | bot-alert: ${alertCheck.alert}`);
    console.log(`VERDICT: ${verdict}`);
  }

  console.log("\n=== ИТОГО ===");
  console.log(`✅ Корректные (NEW, без ответа): ${correctNew}`);
  console.log(`❌ Ложные IN_PROCESS: ${falseInProcess} (из них с ответом в чате: ${falseInProcessWithChat})`);
  console.log(`⚠️ NEW, но менеджер уже отвечал: ${falseNewWithChat}`);
  console.log(`\nПосле исправления (только NEW без ответа в чате): ~${correctNew + (leads.length - correctNew - falseInProcess - falseNewWithChat)}?`);
  console.log(`Ожидаемо корректных после fix: ${correctNew} (+ возможно NEW с чатом если считать необработанными)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
