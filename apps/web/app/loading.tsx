export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "60vh",
        fontFamily: "var(--font-ui)",
        fontSize: "13px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--ink-faded)"
      }}
    >
      Loading&hellip;
    </div>
  );
}
