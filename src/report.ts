import { DateTime } from "luxon";

export function dueSlot(now: number, zone: string, clock: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const local = DateTime.fromMillis(now, { zone });
  if (!local.isValid) return null;
  const [hour, minute] = clock.split(":").map(Number);
  const scheduled = local.set({ hour, minute, second: 0, millisecond: 0 });
  const lag = now - scheduled.toMillis();
  if (lag < 0 || lag >= 15 * 60_000) return null;
  return {
    day: scheduled.toISODate()!,
    end: scheduled.toMillis(),
    start: scheduled.toMillis() - 86400000,
  };
}

export function summarize(rows: Record<string, unknown>[]) {
  let income = 0,
    expenses = 0;
  for (const row of rows) {
    if (
      typeof row.amount !== "number" ||
      !Number.isSafeInteger(row.amount) ||
      row.amount <= 0 ||
      typeof row.credit !== "boolean"
    )
      throw Error("Invalid ledger entry");
    if (row.credit) income += row.amount;
    else expenses += row.amount;
  }
  return { income, expenses, count: rows.length };
}
export const rupees = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );

export function details(
  rows: Record<string, any>[],
  profile: Record<string, any>,
  previous: Record<string, any>[],
  zone: string,
  fields: string[],
) {
  const output: string[] = [];
  const { income, expenses } = summarize(rows);
  if (fields.includes("balances")) {
    if (typeof profile.opening === "number") {
      const before = summarize(previous);
      const opening = profile.opening + before.income - before.expenses;
      output.push(
        "Calculated opening " +
          rupees(opening) +
          " | Calculated closing " +
          rupees(opening + income - expenses) +
          " (user-entered opening balance)",
      );
    } else output.push("Opening balance unavailable");
  }
  if (fields.includes("categories")) {
    const totals = new Map<string, number>();
    for (const row of rows)
      if (!row.credit) {
        const category = row.fixed ? "Fixed" : row.category || "Others";
        totals.set(category, (totals.get(category) || 0) + row.amount);
      }
    for (const [category, total] of totals)
      output.push(category + " " + rupees(total));
  }
  if (fields.includes("budget") && profile.daily > 0) {
    const discretionary = rows
      .filter((r) => !r.fixed && !r.credit)
      .reduce((sum, r) => sum + r.amount, 0);
    output.push(
      "Daily limit " +
        rupees(profile.daily) +
        " | remaining vs report spending " +
        rupees(profile.daily - discretionary) +
        " | " +
        Math.round((discretionary / profile.daily) * 100) +
        "% used",
    );
  }
  if (fields.includes("transactions")) {
    for (const [i, r] of rows.entries()) {
      const line = [
        DateTime.fromMillis(r.time, { zone }).toFormat("dd LLL HH:mm"),
        r.credit ? "Credit" : "Debit",
        rupees(r.amount),
        String(r.title || "").slice(0, 40),
        r.category,
        r.bank,
      ]
        .filter(Boolean)
        .join(" ");
      if (output.join(" | ").length + line.length > 740) {
        output.push(rows.length - i + " additional transactions");
        break;
      }
      output.push(line);
    }
  }
  return (
    output.join(" | ").replace(/\s+/g, " ").slice(0, 900) ||
    "No additional details"
  );
}
