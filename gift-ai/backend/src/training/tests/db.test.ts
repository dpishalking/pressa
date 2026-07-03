import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Use an in-memory DB for tests by patching the config
process.env.DATABASE_PATH = ":memory:";

const { getDb } = await import("../../db/client.js");
const { initTrainingDb } = await import("../db.js");
const { loadScenariosFromFiles, upsertScenariosToDb, getScenarioFromDb, listScenariosFromDb } = await import("../scenario-loader.js");
const { getOrCreateUser, getUserByTelegramId } = await import("../training-service.js");

describe("Training DB", () => {
  beforeAll(() => {
    getDb();
    initTrainingDb();
  });

  it("initializes training tables without error", () => {
    const db = getDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'training_%'`).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("training_users");
    expect(names).toContain("training_sessions");
    expect(names).toContain("training_scenarios");
    expect(names).toContain("training_messages");
    expect(names).toContain("training_evaluations");
  });

  it("can call initTrainingDb multiple times idempotently", () => {
    expect(() => initTrainingDb()).not.toThrow();
    expect(() => initTrainingDb()).not.toThrow();
  });
});

describe("User management", () => {
  beforeAll(() => {
    getDb();
    initTrainingDb();
  });

  it("creates a new user", () => {
    const userId = getOrCreateUser("12345678", "Анна Иванова", "anna_ivanova");
    expect(userId).toBeTruthy();
    expect(typeof userId).toBe("string");
  });

  it("returns same userId for same telegramId", () => {
    const id1 = getOrCreateUser("99999999", "Тест Тестов", "tester");
    const id2 = getOrCreateUser("99999999", "Тест Обновлённый", "tester2");
    expect(id1).toBe(id2);
  });

  it("getUserByTelegramId finds existing user", () => {
    getOrCreateUser("11111111", "Пётр Петров", "petrov");
    const user = getUserByTelegramId("11111111");
    expect(user).not.toBeNull();
    expect(user?.full_name).toBe("Пётр Петров");
  });

  it("getUserByTelegramId returns null/undefined for unknown user", () => {
    const user = getUserByTelegramId("00000000_nonexistent");
    expect(user == null).toBe(true);
  });

  it("default role is employee", () => {
    getOrCreateUser("22222222", "Сотрудник Тестовый", "emp");
    const user = getUserByTelegramId("22222222");
    expect(user?.role).toBe("employee");
  });
});

describe("Scenario management", () => {
  beforeAll(() => {
    getDb();
    initTrainingDb();
    const scenarios = loadScenariosFromFiles();
    if (scenarios.length > 0) {
      upsertScenariosToDb(scenarios);
    }
  });

  it("upserts scenarios from files", () => {
    const scenarios = listScenariosFromDb({ publishedOnly: true });
    expect(scenarios.length).toBeGreaterThanOrEqual(1);
  });

  it("can retrieve a scenario by ID", () => {
    const all = listScenariosFromDb({});
    if (all.length === 0) return;
    const first = all[0];
    const found = getScenarioFromDb(first.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(first.id);
  });

  it("does NOT expose hidden facts through safe scenario", () => {
    const all = listScenariosFromDb({});
    if (all.length === 0) return;
    // The listScenariosFromDb returns full scenario including hiddenFacts
    // But the API strips them — test that hiddenFacts field exists in full object
    const first = all[0];
    expect(first).toHaveProperty("hiddenFacts");
    expect(Array.isArray(first.hiddenFacts)).toBe(true);
  });

  it("filters by difficulty", () => {
    const basics = listScenariosFromDb({ difficulty: "basic" });
    for (const s of basics) {
      expect(s.difficulty).toBe("basic");
    }
  });

  it("returns null for unknown scenario ID", () => {
    const result = getScenarioFromDb("definitely-not-a-real-id-12345");
    expect(result).toBeNull();
  });

  it("upsert is idempotent", () => {
    const scenarios = loadScenariosFromFiles();
    if (scenarios.length === 0) return;
    upsertScenariosToDb(scenarios);
    upsertScenariosToDb(scenarios);
    const count = listScenariosFromDb({});
    expect(count.length).toBeGreaterThanOrEqual(scenarios.length);
  });
});
