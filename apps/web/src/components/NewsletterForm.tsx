"use client";

import { useState } from "react";

export function NewsletterForm({
  variant
}: {
  variant: "bar" | "footer";
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  const prefix = variant === "bar" ? "newsletter-bar" : "footer-newsletter";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("You're in! Check your email to confirm.");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className={`newsletter-message newsletter-success ${prefix}-message`}>
        {message}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`${prefix}-form`}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={variant === "bar" ? "Enter your email" : "Your email address"}
        required
        className={`${prefix}-input`}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className={`${prefix}-button`}
      >
        {status === "loading" ? "Subscribing\u2026" : "Subscribe"}
      </button>
      {status === "error" && message && (
        <div className={`newsletter-message newsletter-error ${prefix}-message`}>
          {message}
        </div>
      )}
    </form>
  );
}
