#!/usr/bin/env node
// Creates .env from .env.example if needed and fills AUTH_SECRET,
// POSTGRES_PASSWORD and KANEO_OWNER_PASSWORD when they are empty.
// Values already set are never changed. Safe to re-run.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillSecrets } from "./env-file.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, ".env");
const before = existsSync(envFile)
  ? readFileSync(envFile, "utf8")
  : readFileSync(join(here, ".env.example"), "utf8");

const after = fillSecrets(before, {
  AUTH_SECRET: randomBytes(32).toString("hex"),
  POSTGRES_PASSWORD: randomBytes(16).toString("hex"),
  KANEO_OWNER_PASSWORD: randomBytes(12).toString("base64url"),
});
writeFileSync(envFile, after, { mode: 0o600 });
chmodSync(envFile, 0o600);
console.log(after === before ? ".env is complete" : ".env secrets filled");
