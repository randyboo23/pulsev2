import { adminCookieValue, adminCookieName } from "@/src/lib/admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function AdminLoginPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const value = cookies().get(adminCookieName())?.value;
  if (value === adminCookieValue()) {
    redirect("/admin/stories");
  }

  return (
    <main className="main">
      <section className="card">
        <h2>Admin Login</h2>
        <p>Enter the admin secret to continue.</p>
        <form action="/api/admin/login" method="post" className="story-list">
          <input
            type="password"
            name="secret"
            placeholder="Admin secret"
            style={{ padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
          />
          <button className="filter" type="submit">Sign in</button>
          {searchParams?.error ? (
            <span style={{ color: "var(--accent-2)", fontSize: "12px" }}>Invalid secret</span>
          ) : null}
        </form>
      </section>
    </main>
  );
}
