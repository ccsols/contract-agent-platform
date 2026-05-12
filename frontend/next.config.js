/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://122.51.247.121:5000/api/:path*'
      }
    ];
  }
};

module.exports = nextConfig;
