import { ingestFeeds } from "@/src/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  const headerSecret = request.headers.get("x-ingest-secret");
  return headerSecret === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await ingestFeeds();
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return new Response("Ingest failed", { status: 500 });
  }
}

export async function GET(request: Request) {
  return new Response("Use POST /api/ingest", { status: 405 });
}
