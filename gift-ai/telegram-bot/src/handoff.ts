import { escHtml } from "./format.js";

/** https://t.me/user?text=… → tg://resolve (надёжнее в ссылках внутри сообщения). */
export function toTgResolveUrl(httpsUrl: string): string {
  try {
    const u = new URL(httpsUrl);
    if (u.hostname !== "t.me") return httpsUrl;
    const domain = u.pathname.replace(/^\//, "");
    const text = u.searchParams.get("text");
    if (!text) return `tg://resolve?domain=${domain}`;
    return `tg://resolve?domain=${domain}&text=${encodeURIComponent(text)}`;
  } catch {
    return httpsUrl;
  }
}

export function managerLinkHtml(handoff: { url: string; buttonLabel: string }): string {
  const href = handoff.url.replace(/&/g, "&amp;");
  return `<a href="${href}">${escHtml(handoff.buttonLabel)}</a>`;
}
