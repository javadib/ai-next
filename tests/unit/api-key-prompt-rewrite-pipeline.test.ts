import test from "node:test";
import assert from "node:assert/strict";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const h = await createChatPipelineHarness("prompt-rewrite-pipeline");

// Loosely typed JSON (what JSON.parse yields) so assertions can index upstream bodies.
type Json = ReturnType<typeof JSON.parse>;
type FetchCall = { url: string; body: Record<string, Json> };
let calls: FetchCall[] = [];

const RULE = {
  enabled: true,
  system: { mode: "replace" as const, text: "OPERATOR SYSTEM" },
  user: { mode: "template" as const, text: "[[{{user_prompt}}]]" },
};

async function seedKey(promptRewrite: typeof RULE | null) {
  const key = await h.seedApiKey({ name: promptRewrite ? "rewrite-on" : "rewrite-off" });
  if (promptRewrite) {
    await h.apiKeysDb.updateApiKeyPermissions(key.id, { promptRewrite });
  }
  return key;
}

function recordJson(responder: (call: FetchCall, index: number) => Response) {
  globalThis.fetch = async (url, init: RequestInit = {}) => {
    const call = { url: String(url), body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return responder(call, calls.length - 1);
  };
}

const systemMessages = (body: Record<string, Json>) =>
  (body.messages || []).filter((m: Json) => m.role === "system" || m.role === "developer");

test.beforeEach(async () => {
  await h.resetStorage();
  h.BaseExecutor.RETRY_CONFIG.delayMs = 0;
  calls = [];
});

test.afterEach(async () => {
  h.BaseExecutor.RETRY_CONFIG.delayMs = h.originalRetryDelayMs;
});

test.after(() => h.cleanup());

const openaiRequest = (authKey: string, extra: Record<string, unknown> = {}) =>
  h.buildRequest({
    authKey,
    body: {
      model: "openai/gpt-4o-mini",
      stream: false,
      messages: [
        { role: "system", content: "CLIENT SYSTEM" },
        { role: "user", content: "hello" },
      ],
      ...extra,
    },
  });

test("pipeline rewrites system + user prompt for a key with the rule enabled", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-rewrite" });
  const key = await seedKey(RULE);
  recordJson(() => h.buildOpenAIResponse("ok"));

  const response = await h.handleChat(openaiRequest(key.key));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(calls.length, 1);
  const sent = calls[0].body;
  assert.deepEqual(systemMessages(sent), [{ role: "system", content: "OPERATOR SYSTEM" }]);
  assert.equal(sent.messages.at(-1).content, "[[hello]]");
});

test("pipeline leaves the request untouched for a key without the rule", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-plain" });
  const key = await seedKey(null);
  recordJson(() => h.buildOpenAIResponse("ok"));

  const response = await h.handleChat(openaiRequest(key.key));
  assert.equal(response.status, 200);
  const sent = calls[0].body;
  assert.deepEqual(systemMessages(sent), [{ role: "system", content: "CLIENT SYSTEM" }]);
  assert.equal(sent.messages.at(-1).content, "hello");
});

test("pipeline does nothing when the stored rule is disabled", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-disabled" });
  const key = await seedKey({ ...RULE, enabled: false } as typeof RULE);
  recordJson(() => h.buildOpenAIResponse("ok"));

  await h.handleChat(openaiRequest(key.key));
  assert.equal(calls[0].body.messages.at(-1).content, "hello");
});

test("pipeline applies the rewrite to streaming requests", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-stream" });
  const key = await seedKey(RULE);
  recordJson(
    () =>
      new Response(
        'data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n' +
          'data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
          "data: [DONE]\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
  );

  const response = await h.handleChat(openaiRequest(key.key, { stream: true }));
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(calls.length, 1);
  assert.deepEqual(systemMessages(calls[0].body), [{ role: "system", content: "OPERATOR SYSTEM" }]);
  assert.equal(calls[0].body.messages.at(-1).content, "[[hello]]");
});

test("pipeline rewrites an Anthropic Messages request before translation", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-claude-src" });
  const key = await seedKey(RULE);
  recordJson(() => h.buildOpenAIResponse("ok"));

  const response = await h.handleChat(
    h.buildRequest({
      url: "http://localhost/v1/messages",
      authKey: key.key,
      body: {
        model: "openai/gpt-4o-mini",
        max_tokens: 64,
        stream: false,
        system: "CLIENT SYSTEM",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      },
    })
  );
  assert.equal(response.status, 200, await response.clone().text());
  const sent = calls[0].body;
  const systemText = systemMessages(sent)
    .map((m: Json) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("|");
  assert.match(systemText, /OPERATOR SYSTEM/);
  assert.doesNotMatch(systemText, /CLIENT SYSTEM/);
  assert.match(JSON.stringify(sent.messages.at(-1).content), /\[\[hello\]\]/);
});

test("combo routing applies the rewrite once, before fan-out, to every target", async () => {
  await h.seedConnection("openai", { apiKey: "sk-openai-combo" });
  await h.seedConnection("claude", { apiKey: "sk-claude-combo" });
  await h.combosDb.createCombo({
    name: "rewrite-combo",
    strategy: "priority",
    config: { maxRetries: 0, retryDelayMs: 0 },
    models: ["openai/gpt-4o-mini", "claude/claude-sonnet-4-6"],
  });
  const key = await seedKey(RULE);
  recordJson((call) =>
    call.url.includes("anthropic")
      ? h.buildClaudeResponse("from second target", "claude-sonnet-4-6")
      : new Response(JSON.stringify({ error: { message: "upstream down" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
  );

  const response = await h.handleChat(
    h.buildRequest({
      authKey: key.key,
      body: {
        model: "rewrite-combo",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
    })
  );
  assert.equal(response.status, 200, await response.clone().text());
  const openaiCalls = calls.filter((c) => !c.url.includes("anthropic"));
  const claudeCalls = calls.filter((c) => c.url.includes("anthropic"));
  assert.ok(openaiCalls.length >= 1, "first target was tried");
  assert.equal(claudeCalls.length, 1, "fell over to the second target");

  for (const call of openaiCalls) {
    assert.deepEqual(systemMessages(call.body), [{ role: "system", content: "OPERATOR SYSTEM" }]);
    assert.equal(call.body.messages.at(-1).content, "[[hello]]");
  }
  // Second target: translated to Anthropic, still rewritten exactly once.
  const claudeBody = claudeCalls[0].body;
  const systemText = JSON.stringify(claudeBody.system ?? "");
  assert.equal(systemText.split("OPERATOR SYSTEM").length - 1, 1, systemText);
  const lastUser = JSON.stringify(claudeBody.messages.at(-1).content);
  assert.equal(lastUser.split("[[").length - 1, 1, lastUser);
  assert.match(lastUser, /\[\[hello\]\]/);
});
