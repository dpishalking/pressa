import {
  countryDisplayValue,
  findFieldByTitle,
  getDealFieldMap,
  getLeadFieldMap,
  listBitrixDeals,
  listBitrixLeads,
  listBitrixStatusLabels,
  resolveBitrixUserNames,
  type BitrixDeal,
  type BitrixLead,
  type CrmFieldMeta,
} from "../crm/bitrix-client.js";
import type { ManagersExportConfig } from "./managers-config.js";
import {
  createExportFx,
  monthRange,
  NO_COUNTRY_LABEL,
  type ExportDateRange,
} from "./bitrix-country-export.js";
import { logger } from "../../logger.js";

export type ManagerSummaryRow = {
  managerId: string;
  managerName: string;
  leads: number;
  deals: number;
  revenueEur: number;
  avgCheck: number;
  leadSharePct: number;
  revenueSharePct: number;
  leadToDealPct: number;
};

export type ManagerCountryRow = {
  country: string;
  leads: number;
  deals: number;
  revenueEur: number;
  avgCheck: number;
};

export type ManagerDealRow = {
  id: string;
  closeDate: string;
  title: string;
  amountEur: number;
  country: string;
  source: string;
};

export type ManagerDashboard = {
  managerId: string;
  managerName: string;
  summary: ManagerSummaryRow;
  countries: ManagerCountryRow[];
  deals: ManagerDealRow[];
};

export type ManagerSummaryResult = {
  range: ExportDateRange;
  month: string;
  managers: ManagerDashboard[];
  totalLeads: number;
  totalDeals: number;
  totalRevenueEur: number;
  baseCurrency: string;
};

type CountryBucket = {
  leads: number;
  deals: number;
  revenueEur: number;
};

function buildSalesDealFilter(range: ExportDateRange, salesStageIds: string[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ">=CLOSEDATE": range.from,
    "<CLOSEDATE": range.to,
  };
  if (salesStageIds.length === 1) {
    filter["=STAGE_ID"] = salesStageIds[0];
  } else if (salesStageIds.length > 1) {
    filter["@STAGE_ID"] = salesStageIds;
  }
  return filter;
}

function managerLabel(managerId: string, users: Map<string, string>): string {
  return users.get(managerId)?.trim() || managerId;
}

function countryForLead(
  lead: BitrixLead,
  countryField: string,
  fieldMeta: Record<string, CrmFieldMeta>,
): string {
  const value = countryDisplayValue(fieldMeta, countryField, lead[countryField]);
  return value.trim() || NO_COUNTRY_LABEL;
}

function countryForDeal(
  deal: BitrixDeal,
  countryField: string,
  fieldMeta: Record<string, CrmFieldMeta>,
): string {
  const value = countryDisplayValue(fieldMeta, countryField, deal[countryField]);
  return value.trim() || NO_COUNTRY_LABEL;
}

function bumpCountry(bucket: Map<string, CountryBucket>, country: string, patch: Partial<CountryBucket>): void {
  const row = bucket.get(country) ?? { leads: 0, deals: 0, revenueEur: 0 };
  bucket.set(country, {
    leads: row.leads + (patch.leads ?? 0),
    deals: row.deals + (patch.deals ?? 0),
    revenueEur: row.revenueEur + (patch.revenueEur ?? 0),
  });
}

async function resolveCountryFields(cfg: ManagersExportConfig): Promise<{
  leadField: string;
  dealField: string;
  leadFields: Record<string, CrmFieldMeta>;
  dealFields: Record<string, CrmFieldMeta>;
}> {
  const [leadFields, dealFields] = await Promise.all([getLeadFieldMap(), getDealFieldMap()]);
  const leadField = cfg.leadCountryField ?? findFieldByTitle(leadFields, "Страна");
  const dealField = cfg.dealCountryField ?? findFieldByTitle(dealFields, "Страна");

  if (!leadField) {
    throw new Error('Не найдено поле «Страна» в лидах. Укажите BITRIX_COUNTRY_FIELD=UF_CRM_... в .env');
  }
  if (!dealField) {
    throw new Error('Не найдено поле «Страна» в сделках. Укажите BITRIX_DEAL_COUNTRY_FIELD=UF_CRM_... в .env');
  }

  return { leadField, dealField, leadFields, dealFields };
}

export async function buildManagerSummary(opts: {
  month?: string;
  range?: ExportDateRange;
  config: ManagersExportConfig;
  salesStageIds?: string[];
}): Promise<ManagerSummaryResult> {
  const month = opts.month ?? opts.range?.from.slice(0, 7) ?? "";
  const range = opts.range ?? (month ? monthRange(month) : { from: "", to: "" });
  const salesStageIds = opts.salesStageIds ?? opts.config.salesStageIds;
  const fx = await createExportFx(
    {
      sheetId: opts.config.sheetId,
      serviceAccountJson: opts.config.serviceAccountJson,
      countryTags: [],
      leadCountryField: opts.config.leadCountryField,
      dealCountryField: opts.config.dealCountryField,
      baseCurrency: opts.config.baseCurrency,
      fxOverrides: opts.config.fxOverrides,
      salesStageIds,
    },
    range,
  );

  const [{ leadField, dealField, leadFields, dealFields }, sourceLabels] = await Promise.all([
    resolveCountryFields(opts.config),
    listBitrixStatusLabels("SOURCE"),
  ]);

  const [leads, deals] = await Promise.all([
    listBitrixLeads({ ">=DATE_CREATE": range.from, "<DATE_CREATE": range.to }, [leadField]),
    listBitrixDeals(buildSalesDealFilter(range, salesStageIds), [dealField]),
  ]);

  const managerIds = new Set<string>();
  const leadCounts = new Map<string, number>();
  const dealCounts = new Map<string, number>();
  const revenueByManager = new Map<string, number>();
  const countriesByManager = new Map<string, Map<string, CountryBucket>>();
  const dealsByManager = new Map<string, ManagerDealRow[]>();

  for (const lead of leads) {
    const managerId = String(lead.ASSIGNED_BY_ID ?? "").trim() || "0";
    managerIds.add(managerId);
    leadCounts.set(managerId, (leadCounts.get(managerId) ?? 0) + 1);
    const country = countryForLead(lead, leadField, leadFields);
    const buckets = countriesByManager.get(managerId) ?? new Map<string, CountryBucket>();
    bumpCountry(buckets, country, { leads: 1 });
    countriesByManager.set(managerId, buckets);
  }

  for (const deal of deals) {
    const managerId = String(deal.ASSIGNED_BY_ID ?? "").trim() || "0";
    const amountEur = fx.convert(Number.parseFloat(deal.OPPORTUNITY ?? "0") || 0, deal.CURRENCY_ID);
    const country = countryForDeal(deal, dealField, dealFields);
    const source = sourceLabels.get(deal.SOURCE_ID ?? "") ?? deal.SOURCE_ID ?? "";

    managerIds.add(managerId);
    dealCounts.set(managerId, (dealCounts.get(managerId) ?? 0) + 1);
    revenueByManager.set(managerId, (revenueByManager.get(managerId) ?? 0) + amountEur);

    const buckets = countriesByManager.get(managerId) ?? new Map<string, CountryBucket>();
    bumpCountry(buckets, country, { deals: 1, revenueEur: amountEur });
    countriesByManager.set(managerId, buckets);

    const dealRows = dealsByManager.get(managerId) ?? [];
    dealRows.push({
      id: String(deal.ID),
      closeDate: (deal.CLOSEDATE ?? "").slice(0, 10),
      title: deal.TITLE ?? "",
      amountEur,
      country,
      source,
    });
    dealsByManager.set(managerId, dealRows);
  }

  const totalLeads = leads.length;
  const totalDeals = deals.length;
  const totalRevenueEur = [...revenueByManager.values()].reduce((sum, value) => sum + value, 0);
  const users = await resolveBitrixUserNames([...managerIds]);

  const managers: ManagerDashboard[] = [...managerIds]
    .filter((managerId) => (leadCounts.get(managerId) ?? 0) > 0 || (dealCounts.get(managerId) ?? 0) > 0)
    .map((managerId) => {
      const leadCount = leadCounts.get(managerId) ?? 0;
      const dealCount = dealCounts.get(managerId) ?? 0;
      const revenueEur = revenueByManager.get(managerId) ?? 0;
      const managerName = managerLabel(managerId, users);

      const summary: ManagerSummaryRow = {
        managerId,
        managerName,
        leads: leadCount,
        deals: dealCount,
        revenueEur,
        avgCheck: dealCount ? revenueEur / dealCount : 0,
        leadSharePct: totalLeads ? (leadCount / totalLeads) * 100 : 0,
        revenueSharePct: totalRevenueEur ? (revenueEur / totalRevenueEur) * 100 : 0,
        leadToDealPct: leadCount ? (dealCount / leadCount) * 100 : 0,
      };

      const countries = [...(countriesByManager.get(managerId)?.entries() ?? [])]
        .map(([country, bucket]) => ({
          country,
          leads: bucket.leads,
          deals: bucket.deals,
          revenueEur: bucket.revenueEur,
          avgCheck: bucket.deals ? bucket.revenueEur / bucket.deals : 0,
        }))
        .sort((a, b) => b.revenueEur - a.revenueEur || b.leads - a.leads);

      const managerDeals = [...(dealsByManager.get(managerId) ?? [])].sort((a, b) =>
        b.closeDate.localeCompare(a.closeDate),
      );

      return { managerId, managerName, summary, countries, deals: managerDeals };
    })
    .sort((a, b) => b.summary.revenueEur - a.summary.revenueEur || b.summary.leads - a.summary.leads);

  logger.info("Manager summary built", {
    month: month || range.from.slice(0, 7),
    range,
    managers: managers.length,
    totalLeads,
    totalDeals,
    totalRevenueEur,
    baseCurrency: fx.baseCurrency,
  });

  return {
    range,
    month: month || range.from.slice(0, 7),
    managers,
    totalLeads,
    totalDeals,
    totalRevenueEur,
    baseCurrency: fx.baseCurrency,
  };
}
