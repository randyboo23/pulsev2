import { ingestFeeds } from "./jobs/ingest_feeds";
import { enrichArticle } from "./jobs/enrich_article";
import { clusterStories } from "./jobs/cluster_stories";
import { scoreStories } from "./jobs/score_stories";
import { detectLocalTrends } from "./jobs/detect_local_trends";

async function main() {
  // Temporary local runner; trigger.dev will call individual jobs directly.
  const ingest = await ingestFeeds();
  console.log("ingest", ingest);

  await enrichArticle("placeholder-article-id");
  await clusterStories();
  await scoreStories();
  await detectLocalTrends();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
