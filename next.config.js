/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['argon2'],
    instrumentationHook: true,
  },
}

module.exports = nextConfig
