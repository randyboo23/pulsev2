import "./globals.css";
import type { Metadata } from "next";
import { isAdmin } from "@/src/lib/admin";
import { NewsletterForm } from "@/src/components/NewsletterForm";

export const metadata: Metadata = {
  metadataBase: new URL("https://pulsek12.com"),
  title: {
    default: "Pulse K-12 | The Signal in Education News",
    template: "%s | Pulse K-12"
  },
  description:
    "AI-curated K-12 education news. The most important stories in American education, clustered and ranked by impact.",
  openGraph: {
    type: "website",
    siteName: "Pulse K-12",
    title: "Pulse K-12 | The Signal in Education News",
    description:
      "AI-curated K-12 education news. The most important stories in American education, clustered and ranked by impact.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse K-12 | The Signal in Education News",
    description:
      "AI-curated K-12 education news. The most important stories in American education, clustered and ranked by impact."
  },
  robots: { index: true, follow: true }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const showAdmin = isAdmin();

  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <div className="footer-content">
            <span className="footer-brand">Pulse K-12</span>
            <nav className="footer-links">
              <a href="/" className="footer-link">Headlines</a>
              <a href="https://www.pulsek12.com/" className="footer-link" target="_blank" rel="noopener">Newsletter</a>
              <a href="/about" className="footer-link">About</a>
              {showAdmin && (
                <a href="/admin/stories" className="footer-link">
                  Admin
                </a>
              )}
            </nav>
          </div>
          <div className="footer-newsletter">
            <div className="footer-newsletter-inner">
              <div className="footer-newsletter-text">
                <h3 className="footer-newsletter-title">Stay informed</h3>
                <p className="footer-newsletter-desc">
                  Get the week&apos;s most important K-12 news in your inbox every Friday.
                </p>
              </div>
              <NewsletterForm variant="footer" />
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
