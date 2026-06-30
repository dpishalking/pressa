export type BitrixWebhookPayload = {
  event: string;
  domain?: string;
  applicationToken?: string;
  data: Record<string, unknown>;
};

function unflattenFormEntries(entries: Array<[string, string]>): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [flatKey, value] of entries) {
    const parts = flatKey.replace(/\]/g, "").split("[");
    let cursor: Record<string, unknown> = root;

    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      const next = cursor[part];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }

    cursor[parts[parts.length - 1]!] = value;
  }

  return root;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function parseBitrixWebhookBody(req: Request): Promise<BitrixWebhookPayload> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = asRecord(await req.json().catch(() => ({})));
    const auth = asRecord(json.auth);
    return {
      event: String(json.event ?? json.EVENT ?? "").trim(),
      domain: auth.domain ? String(auth.domain) : undefined,
      applicationToken: auth.application_token ? String(auth.application_token) : undefined,
      data: asRecord(json.data ?? json.DATA),
    };
  }

  const text = await req.text();
  const params = new URLSearchParams(text);
  const entries = [...params.entries()];
  const root = unflattenFormEntries(entries);
  const auth = asRecord(root.auth);

  return {
    event: String(root.event ?? "").trim(),
    domain: auth.domain ? String(auth.domain) : undefined,
    applicationToken: auth.application_token ? String(auth.application_token) : undefined,
    data: asRecord(root.data),
  };
}

export function extractEntityId(data: Record<string, unknown>): string {
  const fields = asRecord(data.FIELDS);
  const id = fields.ID ?? data.ID ?? data.id;
  return id != null ? String(id) : "";
}

export function extractDynamicItem(data: Record<string, unknown>): {
  entityTypeId?: number;
  id?: string;
  fields?: Record<string, unknown>;
} {
  const item = asRecord(data.item ?? data.ITEM);
  const fields = asRecord(item.fields ?? item.FIELDS ?? data.FIELDS);
  const entityTypeId = Number(item.entityTypeId ?? item.ENTITY_TYPE_ID ?? data.ENTITY_TYPE_ID ?? fields.entityTypeId);
  const id = item.id ?? item.ID ?? fields.id ?? fields.ID;

  return {
    entityTypeId: Number.isFinite(entityTypeId) ? entityTypeId : undefined,
    id: id != null ? String(id) : undefined,
    fields,
  };
}

export function extractImMessage(data: Record<string, unknown>): {
  sessionId?: string;
  chatId?: string;
  senderId?: string;
  text?: string;
  isConnector?: boolean;
} {
  const messages = data.MESSAGES ?? data.messages;
  const list = Array.isArray(messages) ? messages : messages ? [messages] : [];
  const first = asRecord(list[0]);

  const message = asRecord(first.message ?? first.MESSAGE ?? data.message ?? data.MESSAGE);
  const chat = asRecord(first.chat ?? first.CHAT ?? data.chat ?? data.CHAT);
  const im = asRecord(first.im ?? first.IM ?? data.im ?? data.IM);

  const sessionId =
    message.session_id ??
    message.SESSION_ID ??
    chat.entity_id ??
    chat.ENTITY_ID ??
    im.session_id ??
    im.SESSION_ID;

  const chatId = chat.id ?? chat.ID ?? message.chat_id ?? message.CHAT_ID;
  const senderId = message.user_id ?? message.USER_ID ?? message.senderid ?? message.senderId;
  const text = String(message.text ?? message.TEXT ?? "").trim();
  const connector = String(data.CONNECTOR ?? first.CONNECTOR ?? "").trim();

  return {
    sessionId: sessionId != null ? String(sessionId) : undefined,
    chatId: chatId != null ? String(chatId) : undefined,
    senderId: senderId != null ? String(senderId) : undefined,
    text,
    isConnector: Boolean(connector),
  };
}
