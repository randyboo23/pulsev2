export async function detectLocalTrends() {
  // Weekly job:
  // 1) Tag articles with state/topic
  // 2) Compare counts vs trailing baseline (8-week window)
  // 3) Flag emerging topics per state and synthesize trend blurbs
  // 4) Persist to local_trends table
  return {
    trends: 0
  };
}
