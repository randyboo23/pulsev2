export default function NotFound() {
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
          <div className="article-kicker">404</div>
          <h1 className="article-title">Page Not Found</h1>
          <p className="article-summary">
            The page you&apos;re looking for doesn&apos;t exist or has been
            moved. Head back to the homepage for the latest K-12 news.
          </p>
        </header>
      </main>
    </>
  );
}
