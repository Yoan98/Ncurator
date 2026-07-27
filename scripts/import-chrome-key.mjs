import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];

if (!source) {
  console.error("Usage: node scripts/import-chrome-key.mjs /path/to/service-account.json");
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envPath = path.join(root, ".env");
const credentials = JSON.parse(await readFile(path.resolve(source), "utf8"));

if (
  credentials.type !== "service_account" ||
  typeof credentials.client_email !== "string" ||
  typeof credentials.private_key !== "string"
) {
  console.error("The selected file is not a valid Google service account key.");
  process.exit(1);
}

let env = await readFile(envPath, "utf8");
const values = {
  CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL: credentials.client_email,
  CHROME_SERVICE_ACCOUNT_PRIVATE_KEY: JSON.stringify(credentials.private_key),
};

for (const [name, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(env)) {
    console.error(`Missing ${name} in .env.`);
    process.exit(1);
  }
  env = env.replace(pattern, `${name}=${value}`);
}

await writeFile(envPath, env, { mode: 0o600 });
await chmod(envPath, 0o600);
console.log("Chrome service account credentials imported into .env.");
