import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

export function loadServiceAccount(rawOrPath: string): GoogleServiceAccount {
  const trimmed = rawOrPath.trim();
  if (!trimmed) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON не задан");

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as GoogleServiceAccount;
  }

  return JSON.parse(readFileSync(trimmed, "utf8")) as GoogleServiceAccount;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJwt(account: GoogleServiceAccount, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

export async function getGoogleAccessToken(account: GoogleServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const assertion = signJwt(account, "https://www.googleapis.com/auth/spreadsheets");
  const res = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error ?? `Google auth failed: HTTP ${res.status}`);
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}
