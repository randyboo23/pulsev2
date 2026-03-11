import { ingestFeeds } from "@/src/lib/ingest";
import { isSecretAuthorized } from "@/src/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  return isSecretAuthorized(request, {
    headerSecrets: [
      {
        headerName: "x-ingest-secret",
        secret: process.env.INGEST_SECRET
      }
    ],
    bearerSecrets: [process.env.CRON_SECRET, process.env.INGEST_SECRET]
  });
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
