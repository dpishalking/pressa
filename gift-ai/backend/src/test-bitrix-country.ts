import { config } from "./config.js";
import {
  countryEnumId,
  findFieldByTitle,
  getDealFieldMap,
  getLeadFieldMap,
  listCountryEnumValues,
  probeCountryFilter,
} from "./integrations/crm/bitrix-client.js";

async function main(): Promise<void> {
  const country = process.argv[2]?.trim() || "Эстония";
  if (!config.BITRIX24_WEBHOOK_URL) {
    throw new Error("BITRIX24_WEBHOOK_URL не задан в .env");
  }

  const [leadFields, dealFields] = await Promise.all([getLeadFieldMap(), getDealFieldMap()]);
  const leadField = config.BITRIX_COUNTRY_FIELD.trim() || findFieldByTitle(leadFields, "Страна");
  const dealField = config.BITRIX_DEAL_COUNTRY_FIELD.trim() || findFieldByTitle(dealFields, "Страна");

  if (!leadField) {
    throw new Error('Поле «Страна» не найдено. Укажите BITRIX_COUNTRY_FIELD=UF_CRM_... в .env');
  }

  const enumId = countryEnumId(leadFields, leadField, country);
  const countries = await listCountryEnumValues(leadFields, leadField);

  console.log("Поле страны (лиды):", leadField);
  console.log("Поле страны (сделки):", dealField);
  console.log(`Страна «${country}» → enum ID:`, enumId ?? "не найден");
  console.log("Всего стран в списке:", countries.length);
  console.log("Примеры:", countries.slice(0, 8).map((row) => `${row.name} (${row.id})`).join(", "));

  const leadProbe = await probeCountryFilter("crm.lead.list", leadField, country, leadFields);
  console.log("\nЛиды:");
  console.log("  filter:", JSON.stringify(leadProbe.filter));
  console.log("  total:", leadProbe.total);

  if (dealField) {
    const dealProbe = await probeCountryFilter("crm.deal.list", dealField, country, dealFields);
    console.log("\nСделки:");
    console.log("  filter:", JSON.stringify(dealProbe.filter));
    console.log("  total:", dealProbe.total);
  }

  if (leadProbe.total === 0) {
    console.log("\nЕсли total = 0, проверьте точное название страны в списке выше.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
