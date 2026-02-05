import "./globals.css";
import type { Metadata } from "next";
import { isAdmin } from "@/src/lib/admin";

export const metadata: Metadata = {
  title: "Pulse K-12 | The Signal in Education News",
  description: "A shared homepage for US education news, clustered and ranked by impact."
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
              <a href="/newsletter" className="footer-link">Newsletter</a>
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
              <form className="footer-newsletter-form" action="/api/newsletter/subscribe" method="POST">
                <input
                  type="email"
                  name="email"
                  className="footer-newsletter-input"
                  placeholder="Your email address"
                  required
                />
                <button type="submit" className="footer-newsletter-button">
                  Subscribe
                </button>
              </form>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
