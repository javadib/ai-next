import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-key-prompt-rewrite-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-key-prompt-rewrite-secret";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const { updateKeyPermissionsSchema, createKeySchema } =
  await import("../../src/shared/validation/schemas.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const RULE = {
  enabled: true,
  system: { mode: "prepend" as const, text: "You are the AI Next assistant." },
  user: { mode: "template" as const, text: "Answer briefly: {{user_prompt}}" },
};

test("migration 213 adds a nullable prompt_rewrite column without touching existing rows", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE api_keys (id TEXT PRIMARY KEY); INSERT INTO api_keys VALUES ('k1');");
    db.exec(
      readFileSync(
        new URL("../../src/lib/db/migrations/213_api_key_prompt_rewrite.sql", import.meta.url),
        "utf8"
      )
    );
    assert.deepEqual(db.prepare("SELECT * FROM api_keys").get(), {
      id: "k1",
      prompt_rewrite: null,
    });
  } finally {
    db.close();
  }
});

test("new keys have no prompt rewrite", async () => {
  const created = await apiKeysDb.createApiKey("plain", "machine1234567890");
  assert.equal((await apiKeysDb.getApiKeyById(created.id))?.promptRewrite, null);
  assert.equal((await apiKeysDb.getApiKeyMetadata(created.key))?.promptRewrite, null);
});

test("prompt rewrite config persists, reads back on every path, and clears with null", async () => {
  const created = await apiKeysDb.createApiKey("rewrite", "machine1234567890");
  // Warm the metadata cache so the update must invalidate it.
  await apiKeysDb.getApiKeyMetadata(created.key);

  assert.equal(await apiKeysDb.updateApiKeyPermissions(created.id, { promptRewrite: RULE }), true);
  assert.deepEqual((await apiKeysDb.getApiKeyById(created.id))?.promptRewrite, RULE);
  assert.deepEqual((await apiKeysDb.getApiKeyMetadata(created.key))?.promptRewrite, RULE);
  const listed = (await apiKeysDb.getApiKeys()).find((k) => k.id === created.id);
  assert.deepEqual(listed?.promptRewrite, RULE);

  const stored = core
    .getDbInstance()
    .prepare("SELECT prompt_rewrite FROM api_keys WHERE id = ?")
    .get(created.id) as { prompt_rewrite: string };
  assert.deepEqual(JSON.parse(stored.prompt_rewrite), RULE);

  assert.equal(await apiKeysDb.updateApiKeyPermissions(created.id, { promptRewrite: null }), true);
  assert.equal((await apiKeysDb.getApiKeyById(created.id))?.promptRewrite, null);
  assert.equal((await apiKeysDb.getApiKeyMetadata(created.key))?.promptRewrite, null);
});

test("a corrupt stored value reads back as no rewrite instead of throwing", async () => {
  const created = await apiKeysDb.createApiKey("corrupt", "machine1234567890");
  core
    .getDbInstance()
    .prepare("UPDATE api_keys SET prompt_rewrite = ? WHERE id = ?")
    .run('{"enabled":true,"system":{"mode":"nope"', created.id);
  apiKeysDb.resetApiKeyState();
  assert.equal((await apiKeysDb.getApiKeyById(created.id))?.promptRewrite, null);
  assert.equal((await apiKeysDb.getApiKeyMetadata(created.key))?.promptRewrite, null);
});

test("key schemas accept the rule, null, and reject oversized text", () => {
  assert.equal(updateKeyPermissionsSchema.safeParse({ promptRewrite: RULE }).success, true);
  assert.equal(updateKeyPermissionsSchema.safeParse({ promptRewrite: null }).success, true);
  assert.equal(createKeySchema.safeParse({ name: "k", promptRewrite: RULE }).success, true);
  const tooLong = {
    enabled: true,
    system: { mode: "replace", text: "x".repeat(20_001) },
  };
  assert.equal(updateKeyPermissionsSchema.safeParse({ promptRewrite: tooLong }).success, false);
  assert.equal(
    updateKeyPermissionsSchema.safeParse({ promptRewrite: { enabled: "true" } }).success,
    false
  );
});
