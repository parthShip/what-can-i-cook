import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the on-screen dev tools indicator. Compile and runtime errors are
  // still surfaced; only the route/bundler badge goes away.
  devIndicators: false,
};

export default nextConfig;
