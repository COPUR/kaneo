// Small API client shared by the agent-squads scripts.

import { existsSync, readFileSync } from "node:fs";

export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

// Read after loadEnv() so values from .env apply.
export function urls() {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  const apiUrl = (process.env.KANEO_API_URL || `${clientUrl}/api`).replace(
    /\/$/,
    "",
  );
  return { clientUrl, apiUrl };
}

// Minimal client. Without an API key it keeps the session cookie better-auth
// sets on sign-in; with one it acts as that agent.
export function client({ apiKey } = {}) {
  const { clientUrl, apiUrl } = urls();
  let cookie = "";
  return async function call(method, path, body, { allow = [] } = {}) {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: clientUrl,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) {
      cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok && !allow.includes(res.status)) {
      throw new Error(
        `${method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return { status: res.status, data };
  };
}

export function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The API needs a while after `docker compose up` (migrations, nginx).
export async function waitForApi({ timeoutMs = 180_000 } = {}) {
  const { apiUrl } = urls();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Kaneo API did not answer at ${apiUrl}/health`);
}

export async function signIn(call, user, { signUp = false } = {}) {
  const res = await call("POST", "/auth/sign-in/email", user, {
    allow: [401, 403],
  });
  if (res.status === 200) return res.data.user;
  if (!signUp) throw new Error(`Cannot sign in as ${user.email}`);
  const created = await call("POST", "/auth/sign-up/email", user, {
    allow: [400, 422],
  });
  if (created.status !== 200) {
    // The account exists with another password, e.g. signed up in the browser.
    throw new Error(
      `${user.email} exists but its password is not KANEO_OWNER_PASSWORD in .env. Put that account's password in .env and re-run.`,
    );
  }
  return created.data.user;
}
