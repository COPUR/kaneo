import assert from "node:assert/strict";
import { test } from "node:test";
import { fillSecrets } from "./env-file.mjs";

const secrets = { AUTH_SECRET: "a1", POSTGRES_PASSWORD: "p1" };

test("fills empty values and keeps the rest of the file", () => {
  const text = "# note\nAUTH_SECRET=\nPOSTGRES_PASSWORD=\nKANEO_PORT=5173\n";
  assert.equal(
    fillSecrets(text, secrets),
    "# note\nAUTH_SECRET=a1\nPOSTGRES_PASSWORD=p1\nKANEO_PORT=5173\n",
  );
});

test("never replaces a value that is already set", () => {
  const text = "AUTH_SECRET=keep\nPOSTGRES_PASSWORD=\n";
  assert.equal(
    fillSecrets(text, secrets),
    "AUTH_SECRET=keep\nPOSTGRES_PASSWORD=p1\n",
  );
});

test("adds a missing variable at the end", () => {
  assert.equal(
    fillSecrets("A=1", secrets),
    "A=1\nAUTH_SECRET=a1\nPOSTGRES_PASSWORD=p1",
  );
});
