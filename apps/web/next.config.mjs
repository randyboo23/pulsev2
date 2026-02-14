/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pulse/core"],
  async redirects() {
    return [
      {
        source: "/p/:slug*",
        destination: "https://newsletter.pulsek12.com/p/:slug*",
        permanent: true,
      },
      {
        source: "/subscribe",
        destination: "https://newsletter.pulsek12.com/subscribe",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
