import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      'maplibre-gl.mjs': {
        loaders: [`${__dirname}/tools/maplibre-url-loader.cjs`],
        as: '*.js',
      },
    },
  },

  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['ws'],
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],


  webpack(config, { isServer }) {
    if (process.env.NODE_ENV === 'development') {
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 300,
        poll: 3000,
      };
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        module: false,
        worker_threads: false,
      };
    }
    return config;
  },

  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/fastapi/:path*',
        destination: `${process.env.FASTAPI_URL || 'http://127.0.0.1:8569'}/:path*`,
      },
    ];
  },
  async headers() {
    return [
  
      {
        source: '/vendor/maplibre/:version/:file*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: ws: wss: data: blob:; connect-src 'self' http: https: ws: wss: data: blob:; img-src 'self' http: https: data: blob:; worker-src 'self' blob:;",
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
