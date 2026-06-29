/** Конвертация HTML-экспорта Google Sheets (format=zip) в CSV-текст для парсера. */
export function htmlTableToCsv(html: string): string {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const text = tdMatch[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }

  return rows
    .map((cells) =>
      cells
        .map((c) => {
          if (c.includes(",") || c.includes('"') || c.includes("\n")) {
            return `"${c.replace(/"/g, '""')}"`;
          }
          return c;
        })
        .join(","),
    )
    .join("\n");
}

export function sheetSlugFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base
    .replace(/\.html$/i, "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
