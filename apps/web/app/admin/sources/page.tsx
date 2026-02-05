import { redirect } from "next/navigation";
import { isAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import { updateSource } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  if (!isAdmin()) {
    redirect("/admin/login");
  }

  const result = await pool.query(
    `select id, name, domain, tier, weight
     from sources
     order by weight desc, name asc`
  );

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="brand">Pulse K-12</div>
          <div className="tagline">Admin · Sources</div>
        </div>
        <div className="filters">
          <a className="filter" href="/admin/stories">Stories</a>
          <a className="filter" href="/">Home</a>
        </div>
      </header>

      <section className="card">
        <h2>Sources</h2>
        <p>Adjust tiers and weights to influence ranking.</p>
        <div className="story-list">
          {result.rows.map((source) => (
            <div className="story" key={source.id}>
              <form action={updateSource} className="story-list">
                <input type="hidden" name="id" value={source.id} />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Name</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={source.name}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>Domain: {source.domain}</div>
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Tier</label>
                <select
                  name="tier"
                  defaultValue={source.tier}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="unknown">unknown</option>
                </select>
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Weight</label>
                <input
                  type="number"
                  name="weight"
                  step="0.1"
                  defaultValue={source.weight}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <button className="filter" type="submit">Save</button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
