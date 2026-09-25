import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: [
    '@tikzforge/graphic-ir',
    '@tikzforge/plugin-system',
    '@tikzforge/svg-renderer',
    '@tikzforge/tikz-language-service',
    '@tikzforge/tikz-parser',
    '@tikzforge/tikz-serializer',
  ],
  typedRoutes: true,
};

export default nextConfig;
