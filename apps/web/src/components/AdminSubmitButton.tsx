"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

type AdminSubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
  pendingLabel?: string;
  successLabel?: string;
  type?: "submit";
};

export default function AdminSubmitButton({
  children,
  pendingLabel = "Working...",
  successLabel = "Done",
  className,
  disabled,
  ...rest
}: AdminSubmitButtonProps) {
  const { pending } = useFormStatus();
  const [showSuccess, setShowSuccess] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (pending) {
      pendingRef.current = true;
      setShowSuccess(false);
      return;
    }

    if (!pendingRef.current) return;
    pendingRef.current = false;
    setShowSuccess(true);
    const timer = setTimeout(() => setShowSuccess(false), 1400);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <span className="admin-submit-inline">
      <button
        {...rest}
        type="submit"
        className={className}
        disabled={pending || disabled}
      >
        {pending ? pendingLabel : children}
      </button>
      <span className={`admin-submit-confirm${showSuccess ? " is-visible" : ""}`} aria-live="polite">
        {showSuccess ? successLabel : ""}
      </span>
    </span>
  );
}
