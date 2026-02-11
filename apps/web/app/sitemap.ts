import type { MetadataRoute } from "next";
import { pool } from "@/src/lib/db";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulsek12.com";

  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "daily", priority: 1.0 },
    {
      url: `${baseUrl}/about`,
      changeFrequency: "monthly",
      priority: 0.3
    }
  ];

  const { rows } = await pool.query<{ id: string; last_seen_at: string }>(
    `select id, last_seen_at from stories
     where status = 'active'
     order by last_seen_at desc
     limit 500`
  );

  for (const row of rows) {
    entries.push({
      url: `${baseUrl}/stories/${row.id}`,
      lastModified: new Date(row.last_seen_at),
      changeFrequency: "daily",
      priority: 0.7
    });
  }

  return entries;
}
