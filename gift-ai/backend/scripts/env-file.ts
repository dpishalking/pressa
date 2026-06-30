import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function parseEnvFile(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

export function patchEnvFile(path: string, updates: Record<string, string>): string[] {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = original.length ? original.split("\n") : [];
  const changed: string[] = [];
  const keys = new Set(Object.keys(updates));

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!keys.has(key)) continue;
    const next = `${key}=${updates[key]}`;
    if (line !== next) {
      lines[i] = next;
      changed.push(key);
    }
    keys.delete(key);
  }

  if (keys.size) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# ROP alerts (auto-configured by bootstrap-rop-alerts)");
    for (const key of keys) {
      lines.push(`${key}=${updates[key]}`);
      changed.push(key);
    }
  }

  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  return changed;
}

export function numericTelegramIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^-?\d+$/.test(part));
}
