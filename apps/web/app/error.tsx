"use client";

export default function Error({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <header className="masthead">
        <h1 className="masthead-brand">
          <a href="/" style={{ color: "inherit", textDecoration: "none" }}>
            Pulse K-12
          </a>
        </h1>
      </header>

      <main className="main">
        <header className="article-header">
          <a href="/" className="article-back">
            Back to Headlines
          </a>
          <div className="article-kicker">Error</div>
          <h1 className="article-title">Something Went Wrong</h1>
          <p className="article-summary">
            We hit an unexpected problem loading this page. You can try again or
            head back to the homepage.
          </p>
        </header>

        <div style={{ textAlign: "center", marginTop: "2rem" }}>
          <button
            onClick={reset}
            className="newsletter-bar-button"
            style={{ cursor: "pointer" }}
          >
            Try Again
          </button>
        </div>
      </main>
    </>
  );
}
