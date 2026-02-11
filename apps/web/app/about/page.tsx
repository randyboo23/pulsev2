import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About | Pulse K-12",
  description:
    "Pulse K-12 is an AI-curated news service that surfaces the most important stories in American K-12 education."
};

export default function AboutPage() {
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
          <h1 className="article-title">About Pulse K-12</h1>
        </header>

        <section className="about-content">
          <p>
            Pulse K-12 is a news service for the people who run American
            schools. Every day, dozens of outlets publish stories about policy
            changes, classroom practice, technology, and leadership. Most of it
            gets lost. Pulse finds the signal.
          </p>

          <p>
            We use AI to scan hundreds of education news sources, cluster
            related coverage together, and surface the stories that matter most.
            No editorial bias, no sponsored placements — just the news, ranked
            by impact.
          </p>

          <p>
            Pulse K-12 is built for superintendents, principals, school board
            members, teachers, and anyone else who needs to stay informed about
            what&apos;s happening in K-12 education across the country.
          </p>

          <p>
            Want the week&apos;s top stories in your inbox?{" "}
            <a
              href={process.env.NEXT_PUBLIC_NEWSLETTER_URL ?? "https://newsletter.pulsek12.com"}
              target="_blank"
              rel="noopener"
            >
              Subscribe to the newsletter
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
