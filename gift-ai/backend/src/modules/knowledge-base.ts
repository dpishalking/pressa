import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { canonicalExternalIds } from "./product-catalog.js";
import type { Gift, SheetGiftRow } from "../types/index.js";

function formatPrice(min: number, max: number): string {
  if (!min && !max) return "по запросу (зависит от объёма страниц и уровня персонализации)";
  if (min && max && min !== max) return `${min}–${max} ₽`;
  return `${max || min} ₽`;
}

function rowToGift(row: Record<string, unknown>): Gift {
  return {
    id: String(row.id),
    externalId: String(row.external_id ?? ""),
    name: String(row.name),
    description: String(row.description),
    priceMin: Number(row.price_min),
    priceMax: Number(row.price_max),
    emotions: JSON.parse(String(row.emotions || "[]")),
    suitableFor: JSON.parse(String(row.suitable_for || "[]")),
    occasions: JSON.parse(String(row.occasions || "[]")),
    leadTimeDays: Number(row.lead_time_days),
    personalization: String(row.personalization),
    photoUrl: String(row.photo_url),
    cases: String(row.cases),
    reviews: String(row.reviews),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class KnowledgeBase {
  listGifts(activeOnly = true): Gift[] {
    const db = getDb();
    const rows = activeOnly
      ? db.prepare("SELECT * FROM gifts WHERE active = 1 ORDER BY name").all()
      : db.prepare("SELECT * FROM gifts ORDER BY name").all();
    return rows.map((r) => rowToGift(r as Record<string, unknown>));
  }

  getGift(id: string): Gift | null {
    const row = getDb().prepare("SELECT * FROM gifts WHERE id = ?").get(id);
    return row ? rowToGift(row as Record<string, unknown>) : null;
  }

  createGift(input: Omit<Gift, "id" | "createdAt" | "updatedAt" | "externalId"> & { externalId?: string }): Gift {
    const now = new Date().toISOString();
    const id = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO gifts (
          id, external_id, name, description, price_min, price_max, emotions, suitable_for,
          occasions, lead_time_days, personalization, photo_url, cases, reviews,
          active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.externalId ?? "",
        input.name,
        input.description,
        input.priceMin,
        input.priceMax,
        JSON.stringify(input.emotions),
        JSON.stringify(input.suitableFor),
        JSON.stringify(input.occasions),
        input.leadTimeDays,
        input.personalization,
        input.photoUrl,
        input.cases,
        input.reviews,
        input.active ? 1 : 0,
        now,
        now,
      );
    return this.getGift(id)!;
  }

  getByExternalId(externalId: string): Gift | null {
    if (!externalId) return null;
    const row = getDb().prepare("SELECT * FROM gifts WHERE external_id = ?").get(externalId);
    return row ? rowToGift(row as Record<string, unknown>) : null;
  }

  upsertFromSheet(row: SheetGiftRow): { gift: Gift; created: boolean } {
    const existing = this.getByExternalId(row.externalId);
    const payload = {
      externalId: row.externalId,
      name: row.name,
      description: row.description,
      priceMin: row.priceMin,
      priceMax: row.priceMax,
      emotions: row.emotions,
      suitableFor: row.suitableFor,
      occasions: row.occasions,
      leadTimeDays: row.leadTimeDays,
      personalization: row.personalization,
      photoUrl: row.photoUrl,
      cases: row.cases,
      reviews: row.reviews,
      active: row.active,
    };

    if (existing) {
      return { gift: this.updateGift(existing.id, payload)!, created: false };
    }
    return { gift: this.createGift(payload), created: true };
  }

  updateGift(id: string, input: Partial<Omit<Gift, "id" | "createdAt" | "updatedAt">>): Gift | null {
    const existing = this.getGift(id);
    if (!existing) return null;
    const merged = { ...existing, ...input, updatedAt: new Date().toISOString() };
    getDb()
      .prepare(
        `UPDATE gifts SET
          external_id = ?, name = ?, description = ?, price_min = ?, price_max = ?, emotions = ?,
          suitable_for = ?, occasions = ?, lead_time_days = ?, personalization = ?,
          photo_url = ?, cases = ?, reviews = ?, active = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        merged.externalId ?? "",
        merged.name,
        merged.description,
        merged.priceMin,
        merged.priceMax,
        JSON.stringify(merged.emotions),
        JSON.stringify(merged.suitableFor),
        JSON.stringify(merged.occasions),
        merged.leadTimeDays,
        merged.personalization,
        merged.photoUrl,
        merged.cases,
        merged.reviews,
        merged.active ? 1 : 0,
        merged.updatedAt,
        id,
      );
    return this.getGift(id);
  }

  deleteGift(id: string): boolean {
    const r = getDb().prepare("DELETE FROM gifts WHERE id = ?").run(id);
    return r.changes > 0;
  }

  /** Скрывает товары без канонического externalId (старые дубли после синка таблицы). */
  deactivateNonCanonicalGifts(): number {
    const allowed = new Set(canonicalExternalIds());
    let n = 0;
    for (const g of this.listGifts(false)) {
      if (!g.externalId || !allowed.has(g.externalId)) {
        this.updateGift(g.id, { active: false });
        n++;
      }
    }
    return n;
  }

  formatForPrompt(): string {
    const gifts = this.listGifts();
    if (!gifts.length) return "Каталог подарков пуст. Не предлагай конкретные товары — честно скажи, что каталог пока не заполнен.";
    return gifts
      .map(
        (g) =>
          `ID: ${g.externalId || g.id}
Название: ${g.name}
Описание: ${g.description}
Цена: ${formatPrice(g.priceMin, g.priceMax)}
Эмоции: ${g.emotions.join(", ")}
Кому подходит: ${g.suitableFor.join(", ")}
Поводы: ${g.occasions.join(", ")}
Срок изготовления: ${g.leadTimeDays} дн.
Персонализация: ${g.personalization}${g.photoUrl ? `\nФото: ${g.photoUrl}` : ""}
Кейсы: ${g.cases}
Отзывы: ${g.reviews}`,
      )
      .join("\n\n---\n\n");
  }
}

export const knowledgeBase = new KnowledgeBase();
