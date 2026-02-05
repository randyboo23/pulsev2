import { ingestFeeds } from "@/src/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const ingestSecret = process.env.INGEST_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = request.headers.get("x-ingest-secret");
  if (ingestSecret && headerSecret === ingestSecret) return true;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim();
  if (!bearerToken) return false;

  if (cronSecret && bearerToken === cronSecret) return true;
  if (ingestSecret && bearerToken === ingestSecret) return true;
  return false;
}

async function runIngest(request: Request) {
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

export async function POST(request: Request) {
  return runIngest(request);
}

export async function GET(request: Request) {
  return runIngest(request);
}
