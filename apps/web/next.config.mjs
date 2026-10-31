/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ["@semalam/policy", "@semalam/sim", "@semalam/beacon", "semalam"],
  outputFileTracingIncludes: { "/**": ["./data/rounds/**/*"] },
  serverExternalPackages: [],
};

export default config;
