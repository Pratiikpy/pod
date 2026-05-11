/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pod/signal-engine', '@pod/sosovalue-sdk', '@pod/sodex-sdk'],
};

module.exports = nextConfig;
