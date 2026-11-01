import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    cpus: 1,
  },
  async redirects() {
    return [
      {
        source: '/signin',
        destination: '/login',
        permanent: true,
      },
      {
        source: '/browser',
        destination: '/explore',
        permanent: false,
      },
      {
        source: '/browse',
        destination: '/explore',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
