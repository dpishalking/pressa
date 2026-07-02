import { bitrixCall } from "./bitrix-client.js";

export type DealTodo = {
  id: string;
  subject: string;
  deadline: string;
};

export async function listDealOpenTodos(dealId: string): Promise<DealTodo[]> {
  const response = await bitrixCall("crm.activity.list", {
    filter: {
      OWNER_TYPE_ID: "2",
      OWNER_ID: dealId,
      COMPLETED: "N",
      PROVIDER_ID: "CRM_TODO",
    },
    select: ["ID", "SUBJECT", "DEADLINE"],
    order: { DEADLINE: "ASC" },
  });

  return ((response.result as Array<Record<string, string>> | undefined) ?? [])
    .map((row) => ({
      id: String(row.ID),
      subject: row.SUBJECT ?? "",
      deadline: row.DEADLINE ?? "",
    }))
    .filter((row) => row.deadline);
}

export function pickFutureTodoDeadline(todos: DealTodo[], today: string): string {
  return todos
    .map((todo) => todo.deadline.slice(0, 10))
    .filter((date) => date >= today)
    .sort()[0] ?? "";
}

export function pickLatestPastTodoDeadline(todos: DealTodo[], today: string): string {
  return todos
    .map((todo) => todo.deadline.slice(0, 10))
    .filter((date) => date < today)
    .sort()
    .pop() ?? "";
}
