import { getDb } from "../db/client.js";

export type DashboardPlan = {
  month: string;
  leads: number;
  deals: number;
  revenueEur: number;
  updatedAt: string;
};

export function getDashboardPlan(month: string): DashboardPlan | null {
  const row = getDb()
    .prepare(
      `SELECT month, leads, deals, revenue_eur, updated_at FROM dashboard_plans WHERE month = ?`,
    )
    .get(month) as
    | { month: string; leads: number; deals: number; revenue_eur: number; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    month: row.month,
    leads: row.leads,
    deals: row.deals,
    revenueEur: row.revenue_eur,
    updatedAt: row.updated_at,
  };
}

export function upsertDashboardPlan(plan: Omit<DashboardPlan, "updatedAt">): DashboardPlan {
  const updatedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO dashboard_plans (month, leads, deals, revenue_eur, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         leads = excluded.leads,
         deals = excluded.deals,
         revenue_eur = excluded.revenue_eur,
         updated_at = excluded.updated_at`,
    )
    .run(plan.month, plan.leads, plan.deals, plan.revenueEur, updatedAt);
  return { ...plan, updatedAt };
}
