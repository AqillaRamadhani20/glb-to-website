/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const assetCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=3600, stale-while-revalidate=86400",
      },
    ];
    return [
      { source: "/models/:path*", headers: assetCache },
      { source: "/navigation/:path*", headers: assetCache },
    ];
  },
};

export default nextConfig;
