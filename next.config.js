/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['argon2'],
  poweredByHeader: false,
}

module.exports = nextConfig
