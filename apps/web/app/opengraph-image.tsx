import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pulse K-12 — The Signal in Education News";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf8f5",
          fontFamily: "Georgia, serif"
        }}
      >
        {/* Accent stripe at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            backgroundColor: "#b8232f"
          }}
        />

        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#1a1a18",
            letterSpacing: "-0.02em"
          }}
        >
          Pulse K-12
        </div>

        <div
          style={{
            fontSize: 28,
            color: "#5c5c56",
            marginTop: 16,
            letterSpacing: "0.05em",
            textTransform: "uppercase" as const,
            fontFamily: "sans-serif"
          }}
        >
          The Signal in Education News
        </div>

        {/* Bottom rule */}
        <div
          style={{
            position: "absolute",
            bottom: 60,
            width: 120,
            height: 2,
            backgroundColor: "#b8232f"
          }}
        />
      </div>
    ),
    { ...size }
  );
}
