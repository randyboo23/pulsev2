import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const rawPubId = process.env.BEEHIIV_PUBLICATION_ID;
  const pubId = rawPubId?.startsWith("pub_") ? rawPubId : `pub_${rawPubId}`;

  if (!apiKey || !rawPubId) {
    return NextResponse.json(
      { error: "Newsletter service is not configured." },
      { status: 503 }
    );
  }

  let email: string;
  try {
    const body = await request.json();
    email = (body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          utm_source: "pulsek12.com"
        })
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg =
        (err as Record<string, string>).message ||
        "Subscription failed. Please try again.";
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the newsletter service. Please try again." },
      { status: 502 }
    );
  }
}
