/** Сериализует обработку сообщений одного пользователя — без гонок и дублей ответов. */
const chains = new Map<string, Promise<unknown>>();

export function enqueueUserTask<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(uid) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  chains.set(uid, next);
  return next.finally(() => {
    if (chains.get(uid) === next) chains.delete(uid);
  }) as Promise<T>;
}
