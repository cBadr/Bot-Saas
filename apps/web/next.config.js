const path = require('path');

// Load the monorepo-root .env so NEXT_PUBLIC_* and other web-side vars
// don't need to be duplicated in apps/web/.env.local. apps/web/.env.local
// (if it exists) still wins because Next.js loads it after this file runs.
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../..'),
};
module.exports = nextConfig;
