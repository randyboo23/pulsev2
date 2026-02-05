"use server";

import { pool } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/admin";

export async function updateSource(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  const name = formData.get("name")?.toString() ?? null;
  const tier = formData.get("tier")?.toString() ?? "unknown";
  const weightValue = formData.get("weight")?.toString();
  const weight = weightValue ? Number(weightValue) : 1.0;

  await pool.query(
    `update sources
     set name = $2,
         tier = $3,
         weight = $4
     where id = $1`,
    [id, name, tier, weight]
  );
}
