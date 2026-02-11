import type { MetadataRoute } from "next";
import { pool } from "@/src/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: "https://pulsek12.com", changeFrequency: "daily", priority: 1.0 },
    {
      url: "https://pulsek12.com/about",
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
      url: `https://pulsek12.com/stories/${row.id}`,
      lastModified: new Date(row.last_seen_at),
      changeFrequency: "daily",
      priority: 0.7
    });
  }

  return entries;
}
