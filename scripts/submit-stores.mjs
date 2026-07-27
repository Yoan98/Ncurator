import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (!existsSync(envPath)) {
  console.error("Missing .env. Create it from .env.example first.");
  process.exit(1);
}

loadEnvFile(envPath);

const flags = new Set(process.argv.slice(2));
const chromeOnly = flags.has("--chrome-only");
const edgeOnly = flags.has("--edge-only");

if (chromeOnly && edgeOnly) {
  console.error("Choose only one of --chrome-only or --edge-only.");
  process.exit(1);
}

const includeChrome = !edgeOnly;
const includeEdge = !chromeOnly;
const required = [
  ...(includeChrome
    ? [
        "CHROME_EXTENSION_ID",
        "CHROME_PUBLISHER_ID",
        "CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL",
        "CHROME_SERVICE_ACCOUNT_PRIVATE_KEY",
      ]
    : []),
  ...(includeEdge ? ["EDGE_PRODUCT_ID", "EDGE_CLIENT_ID", "EDGE_API_KEY"] : []),
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing store credentials in .env:\n- ${missing.join("\n- ")}`);
  process.exit(1);
}

const { default: packageJson } = await import("../package.json", {
  with: { type: "json" },
});
const { name, version } = packageJson;
const outputDir = path.join(root, ".output");
const chromeZip = path.join(outputDir, `${name}-${version}-chrome.zip`);
const edgeZip = path.join(outputDir, `${name}-${version}-edge.zip`);

const zipPaths = [
  ...(includeChrome ? [chromeZip] : []),
  ...(includeEdge ? [edgeZip] : []),
];

for (const zipPath of zipPaths) {
  if (!existsSync(zipPath)) {
    console.error(`Missing package: ${zipPath}`);
    process.exit(1);
  }
}

const cli = path.join(root, "node_modules/wxt/bin/wxt-publish-extension.mjs");
const args = [cli];

if (includeChrome) {
  args.push("--chrome-api-version", "v2", "--chrome-zip", chromeZip);
}

if (includeEdge) {
  args.push("--edge-zip", edgeZip);
}

if (flags.has("--skip-submit-review")) {
  if (includeChrome) args.push("--chrome-skip-submit-review", "true");
  if (includeEdge) args.push("--edge-skip-submit-review", "true");
}

if (flags.has("--cancel-pending") && includeChrome) {
  args.push("--chrome-cancel-pending", "true");
}

if (flags.has("--dry-run")) {
  args.push("--dry-run");
}

const childEnv = { ...process.env };
const proxyUrl = process.env.STORE_PROXY_URL?.trim();

if (proxyUrl) {
  childEnv.NODE_USE_ENV_PROXY = "1";
  childEnv.HTTP_PROXY = proxyUrl;
  childEnv.HTTPS_PROXY = proxyUrl;
}

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
