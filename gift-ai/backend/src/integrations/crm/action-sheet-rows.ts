import {
  bitrixDealLink,
  bitrixLeadLink,
  bitrixLostDialogueLink,
  bitrixUnpaidInvoiceLink,
} from "./bitrix-links.js";
import type {
  DealInDialogueRow,
  LeadInWorkRow,
  StaleDealRow,
  ThinkDealRow,
  UnpaidInvoiceRow,
  UnprocessedLeadRow,
} from "./bitrix-action-lists.js";
import type { LostDialogueRow } from "./lost-dialogue.js";
import { DEFAULT_THRESHOLDS } from "./bitrix-action-lists.js";
import { sheetAmount, sheetText, type SheetCell } from "../sheets/analytics-write.js";

function thinkIssueLabel(issue: ThinkDealRow["issue"], closeDate: string, today: string): string {
  const thinkDays = DEFAULT_THRESHOLDS.thinkDealMaxOverdueDays;
  if (issue === "no_task") {
    return closeDate && closeDate >= today ? "Нет дела (есть дата в CRM)" : "Нет дела";
  }
  if (issue === "expired") return `Закрыть (>${thinkDays} дн)`;
  return "Просрочен контакт";
}

function thinkToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.STATS_TIMEZONE ?? "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function unpaidInvoiceSheetRows(rows: UnpaidInvoiceRow[], baseCurrency: string): SheetCell[][] {
  return rows.map((row) => [
    row.invoiceId,
    row.dealId,
    sheetText(row.clientName),
    sheetAmount(row.amountEur),
    baseCurrency,
    row.createdDate,
    row.daysUnpaid,
    sheetText(row.managerName),
    sheetText(row.phone),
    bitrixUnpaidInvoiceLink(row),
  ]);
}

export function lostDialogueSheetRows(rows: LostDialogueRow[]): SheetCell[][] {
  return rows.map((row) => [
    row.sessionId,
    row.channel,
    sheetText(row.clientLabel),
    row.dealId || "—",
    row.leadId || "—",
    sheetText(row.phone),
    sheetText(row.managerName),
    row.waitingHours,
    sheetText(row.dateMention || "—"),
    sheetText(row.lastClientMessage),
    bitrixLostDialogueLink(row),
  ]);
}

export function thinkDealSheetRows(rows: ThinkDealRow[], baseCurrency: string): SheetCell[][] {
  const today = thinkToday();
  return rows.map((row) => [
    row.dealId,
    sheetText(row.title),
    sheetAmount(row.amountEur),
    baseCurrency,
    row.nextContactDate || "—",
    row.taskDeadline || "—",
    row.daysOverdue,
    thinkIssueLabel(row.issue, row.nextContactDate, today),
    sheetText(row.managerName),
    sheetText(row.phone),
    bitrixDealLink(row.dealId),
  ]);
}

export function staleDealSheetRows(rows: StaleDealRow[], baseCurrency: string): SheetCell[][] {
  return rows.map((row) => [
    row.entityType === "deal" ? "Сделка" : "Лид",
    row.entityId,
    sheetText(row.title),
    sheetText(row.stageName),
    sheetAmount(row.amountEur),
    baseCurrency,
    row.waitingHours,
    sheetText(row.lastManagerMessage),
    sheetText(row.channel),
    sheetText(row.clientLabel),
    sheetText(row.managerName),
    sheetText(row.phone),
    row.entityType === "deal" ? bitrixDealLink(row.entityId) : bitrixLeadLink(row.entityId),
  ]);
}

export function unprocessedLeadSheetRows(rows: UnprocessedLeadRow[]): SheetCell[][] {
  return rows.map((row) => [
    row.leadId,
    sheetText(row.title),
    sheetText(row.sourceName),
    sheetText(row.country),
    row.createdAt,
    sheetText(row.stageName),
    row.hoursWaiting,
    sheetText(row.managerName),
    sheetText(row.phone),
    bitrixLeadLink(row.leadId),
  ]);
}

export function leadInWorkSheetRows(rows: LeadInWorkRow[]): SheetCell[][] {
  return rows.map((row) => [
    row.leadId,
    sheetText(row.title),
    sheetText(row.sourceName),
    sheetText(row.country),
    row.inWorkSince,
    row.hoursInWork,
    sheetText(row.managerName),
    sheetText(row.phone),
    bitrixLeadLink(row.leadId),
  ]);
}

export function dealInDialogueSheetRows(rows: DealInDialogueRow[], baseCurrency: string): SheetCell[][] {
  return rows.map((row) => [
    row.dealId,
    sheetText(row.title),
    sheetAmount(row.amountEur),
    baseCurrency,
    sheetText(row.channel),
    sheetText(row.clientLabel),
    row.waitingHours,
    sheetText(row.lastClientMessage),
    sheetText(row.managerName),
    sheetText(row.phone),
    bitrixDealLink(row.dealId),
  ]);
}
