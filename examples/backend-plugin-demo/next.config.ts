import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This example lives nested inside the delivery-os repo (which has its
  // own package-lock.json) -- without this, Next.js infers THAT as the
  // workspace root instead of this project's own directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
