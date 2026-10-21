import test from "node:test";
import assert from "node:assert/strict";

const {
  applyPromptRewrite,
  isPromptRewriteActive,
  parsePromptRewriteConfig,
  promptRewriteConfigSchema,
  resolvePromptRewriteFormat,
  PROMPT_REWRITE_MAX_TEXT_LENGTH,
} = await import("../../open-sse/services/promptRewrite.ts");

// Loosely typed JSON (what JSON.parse yields) so assertions can index rewritten bodies.
type Json = ReturnType<typeof JSON.parse>;
type Body = Record<string, Json>;

const sys = (mode: "replace" | "prepend" | "append", text = "OP-SYS") => ({
  enabled: true,
  system: { mode, text },
});
const usr = (mode: "prepend" | "append" | "template", text = "OP-USR") => ({
  enabled: true,
  user: { mode, text },
});

function run(body: Body, config: unknown, format?: string) {
  const frozen = structuredClone(body);
  const result = applyPromptRewrite(body, config as never, format);
  // Pure: the caller's body is never mutated.
  assert.deepEqual(body, frozen);
  return result as { body: Body; systemApplied: boolean; userApplied: boolean };
}

// ──── config parsing / activity ────

test("config: schema caps text length and rejects unknown modes", () => {
  const long = "x".repeat(PROMPT_REWRITE_MAX_TEXT_LENGTH + 1);
  assert.equal(promptRewriteConfigSchema.safeParse(sys("replace", long)).success, false);
  assert.equal(
    promptRewriteConfigSchema.safeParse(sys("replace", "x".repeat(PROMPT_REWRITE_MAX_TEXT_LENGTH)))
      .success,
    true
  );
  assert.equal(
    promptRewriteConfigSchema.safeParse({ enabled: true, system: { mode: "template", text: "a" } })
      .success,
    false
  );
  assert.equal(
    promptRewriteConfigSchema.safeParse({ enabled: true, user: { mode: "replace", text: "a" } })
      .success,
    false
  );
});

test("config: parse accepts JSON text or objects and returns null for garbage", () => {
  assert.deepEqual(parsePromptRewriteConfig(JSON.stringify(sys("append"))), sys("append"));
  assert.deepEqual(parsePromptRewriteConfig(sys("append")), sys("append"));
  assert.equal(parsePromptRewriteConfig(null), null);
  assert.equal(parsePromptRewriteConfig(""), null);
  assert.equal(parsePromptRewriteConfig("{not json"), null);
  assert.equal(parsePromptRewriteConfig({ enabled: "yes" }), null);
});

test("config: disabled, missing or blank-text rules are inactive and change nothing", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  for (const config of [
    null,
    undefined,
    { enabled: false, system: { mode: "replace", text: "X" } },
    { enabled: true },
    { enabled: true, system: { mode: "replace", text: "   " }, user: null },
  ]) {
    assert.equal(isPromptRewriteActive(config as never), false);
    const result = run(body, config);
    assert.equal(result.body, body);
    assert.equal(result.systemApplied, false);
    assert.equal(result.userApplied, false);
  }
});

test("format: explicit source format wins, otherwise the body shape decides", () => {
  assert.equal(resolvePromptRewriteFormat({ messages: [] }, "claude"), "claude");
  assert.equal(resolvePromptRewriteFormat({ input: "x" }, "openai-responses"), "openai-responses");
  assert.equal(resolvePromptRewriteFormat({ messages: [] }, "openai"), "openai");
  assert.equal(resolvePromptRewriteFormat({ contents: [] }, "gemini"), null);
  assert.equal(resolvePromptRewriteFormat({ messages: [], system: "s" }), "claude");
  assert.equal(resolvePromptRewriteFormat({ input: [] }), "openai-responses");
  assert.equal(resolvePromptRewriteFormat({ messages: [] }), "openai");
});

test("unsupported formats (Gemini contents) are returned untouched", () => {
  const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
  const result = run(body, { ...sys("replace"), ...usr("prepend") }, "gemini");
  assert.equal(result.body, body);
});

// ──── OpenAI Chat Completions ────

const openaiBody = () => ({
  model: "gpt",
  messages: [
    { role: "system", content: "CLIENT-SYS" },
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "LAST" },
  ],
});

test("openai system: replace drops every client system/developer message", () => {
  const body = {
    messages: [
      { role: "developer", content: "DEV" },
      { role: "user", content: "u" },
      { role: "system", content: "LATE-SYS" },
    ],
  };
  const { body: out, systemApplied } = run(body, sys("replace"), "openai");
  assert.equal(systemApplied, true);
  assert.deepEqual(out.messages, [
    { role: "developer", content: "OP-SYS" },
    { role: "user", content: "u" },
  ]);
});

test("openai system: prepend / append combine with the client system prompt", () => {
  const pre = run(openaiBody(), sys("prepend"), "openai").body;
  assert.equal(pre.messages[0].content, "OP-SYS\n\nCLIENT-SYS");
  const app = run(openaiBody(), sys("append"), "openai").body;
  assert.equal(app.messages[0].content, "CLIENT-SYS\n\nOP-SYS");
  assert.equal(app.messages.length, 4);
});

test("openai system: every mode creates a system message when the client sent none", () => {
  for (const mode of ["replace", "prepend", "append"] as const) {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const out = run(body, sys(mode), "openai").body;
    assert.deepEqual(out.messages[0], { role: "system", content: "OP-SYS" }, mode);
    assert.equal(out.messages[1].content, "hi");
  }
});

test("openai system: array system content gets the text on its edge text part", () => {
  const body = {
    messages: [
      {
        role: "system",
        content: [
          { type: "text", text: "A" },
          { type: "text", text: "B" },
        ],
      },
      { role: "user", content: "u" },
    ],
  };
  const pre = run(body, sys("prepend"), "openai").body;
  assert.deepEqual(pre.messages[0].content, [
    { type: "text", text: "OP-SYS\n\nA" },
    { type: "text", text: "B" },
  ]);
  const app = run(body, sys("append"), "openai").body;
  assert.deepEqual(app.messages[0].content, [
    { type: "text", text: "A" },
    { type: "text", text: "B\n\nOP-SYS" },
  ]);
});

test("openai user: prepend / append / template touch only the LAST user message", () => {
  const pre = run(openaiBody(), usr("prepend"), "openai");
  assert.equal(pre.userApplied, true);
  assert.equal(pre.body.messages[3].content, "OP-USR\n\nLAST");
  assert.equal(pre.body.messages[1].content, "first");

  const app = run(openaiBody(), usr("append"), "openai").body;
  assert.equal(app.messages[3].content, "LAST\n\nOP-USR");

  const tpl = run(
    openaiBody(),
    usr("template", "Q: {{user_prompt}} / again {{user_prompt}}"),
    "openai"
  ).body;
  assert.equal(tpl.messages[3].content, "Q: LAST / again LAST");
  assert.equal(tpl.messages[0].content, "CLIENT-SYS");
});

test("openai user: template substitution is literal (no $-pattern expansion)", () => {
  const body = { messages: [{ role: "user", content: "cost $& $1" }] };
  const out = run(body, usr("template", "<{{user_prompt}}>"), "openai").body;
  assert.equal(out.messages[0].content, "<cost $& $1>");
});

test("openai user: template without the placeholder replaces the user text", () => {
  const out = run(openaiBody(), usr("template", "fixed"), "openai").body;
  assert.equal(out.messages[3].content, "fixed");
});

test("openai user: array content only changes text parts; image parts are untouched", () => {
  const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } };
  const body = {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "one" }, image, { type: "text", text: "two" }],
      },
    ],
  };
  const pre = run(body, usr("prepend"), "openai").body.messages[0].content;
  assert.deepEqual(pre, [
    { type: "text", text: "OP-USR\n\none" },
    image,
    { type: "text", text: "two" },
  ]);
  assert.equal(pre[1], body.messages[0].content[1]);

  const app = run(body, usr("append"), "openai").body.messages[0].content;
  assert.deepEqual(app, [
    { type: "text", text: "one" },
    image,
    { type: "text", text: "two\n\nOP-USR" },
  ]);

  const tpl = run(body, usr("template", "[{{user_prompt}}]"), "openai").body.messages[0].content;
  assert.deepEqual(tpl, [{ type: "text", text: "[one\ntwo]" }, image]);
  assert.equal(tpl[1], body.messages[0].content[1]);
});

test("openai user: image-only content gains a text part, images stay", () => {
  const image = { type: "image_url", image_url: { url: "https://x/y.png" } };
  const body = { messages: [{ role: "user", content: [image] }] };
  assert.deepEqual(run(body, usr("prepend"), "openai").body.messages[0].content, [
    { type: "text", text: "OP-USR" },
    image,
  ]);
  assert.deepEqual(run(body, usr("append"), "openai").body.messages[0].content, [
    image,
    { type: "text", text: "OP-USR" },
  ]);
  assert.deepEqual(
    run(body, usr("template", "T:{{user_prompt}}"), "openai").body.messages[0].content,
    [image, { type: "text", text: "T:" }]
  );
});

test("openai user: no user message means no user rewrite", () => {
  const body = { messages: [{ role: "system", content: "s" }] };
  const result = run(body, usr("append"), "openai");
  assert.equal(result.userApplied, false);
  assert.equal(result.body, body);
});

test("openai: system and user rules apply together", () => {
  const out = run(
    openaiBody(),
    { enabled: true, system: { mode: "replace", text: "S" }, user: { mode: "append", text: "U" } },
    "openai"
  );
  assert.equal(out.systemApplied && out.userApplied, true);
  assert.equal(out.body.messages[0].content, "S");
  assert.equal(out.body.messages.at(-1).content, "LAST\n\nU");
});

// ──── Anthropic Messages ────

const claudeBody = (system?: unknown) => ({
  model: "claude",
  ...(system !== undefined && { system }),
  messages: [
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: [{ type: "text", text: "LAST" }] },
  ],
});

test("claude system: string system for replace / prepend / append", () => {
  assert.equal(run(claudeBody("CS"), sys("replace"), "claude").body.system, "OP-SYS");
  assert.equal(run(claudeBody("CS"), sys("prepend"), "claude").body.system, "OP-SYS\n\nCS");
  assert.equal(run(claudeBody("CS"), sys("append"), "claude").body.system, "CS\n\nOP-SYS");
});

test("claude system: block system keeps client blocks (and cache_control) intact", () => {
  const blocks = [{ type: "text", text: "CS", cache_control: { type: "ephemeral" } }];
  const pre = run(claudeBody(blocks), sys("prepend"), "claude").body.system;
  assert.deepEqual(pre, [{ type: "text", text: "OP-SYS" }, blocks[0]]);
  const app = run(claudeBody(blocks), sys("append"), "claude").body.system;
  assert.deepEqual(app, [blocks[0], { type: "text", text: "OP-SYS" }]);
  assert.equal(run(claudeBody(blocks), sys("replace"), "claude").body.system, "OP-SYS");
});

test("claude system: missing system becomes the rule text for every mode", () => {
  for (const mode of ["replace", "prepend", "append"] as const) {
    assert.equal(run(claudeBody(), sys(mode), "claude").body.system, "OP-SYS", mode);
  }
});

test("claude user: every mode edits the last user message blocks", () => {
  assert.deepEqual(run(claudeBody(), usr("prepend"), "claude").body.messages[2].content, [
    { type: "text", text: "OP-USR\n\nLAST" },
  ]);
  assert.deepEqual(run(claudeBody(), usr("append"), "claude").body.messages[2].content, [
    { type: "text", text: "LAST\n\nOP-USR" },
  ]);
  const tpl = run(claudeBody(), usr("template", "<<{{user_prompt}}>>"), "claude").body;
  assert.deepEqual(tpl.messages[2].content, [{ type: "text", text: "<<LAST>>" }]);
  assert.equal(tpl.messages[0].content, "first");
});

test("claude user: image blocks are untouched and tool_result-only turns are skipped", () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } };
  const body = { messages: [{ role: "user", content: [image, { type: "text", text: "see" }] }] };
  const out = run(body, usr("append"), "claude").body.messages[0].content;
  assert.equal(out[0], image);
  assert.deepEqual(out[1], { type: "text", text: "see\n\nOP-USR" });

  const toolTurn = {
    messages: [
      { role: "user", content: "do it" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
    ],
  };
  const result = run(toolTurn, usr("prepend"), "claude");
  assert.equal(result.userApplied, false);
  assert.equal(result.body, toolTurn);
});

// ──── OpenAI Responses ────

test("responses system: instructions for replace / prepend / append / missing", () => {
  const body = { input: "hi", instructions: "CI" };
  assert.equal(run(body, sys("replace"), "openai-responses").body.instructions, "OP-SYS");
  assert.equal(run(body, sys("prepend"), "openai-responses").body.instructions, "OP-SYS\n\nCI");
  assert.equal(run(body, sys("append"), "openai-responses").body.instructions, "CI\n\nOP-SYS");
  for (const mode of ["replace", "prepend", "append"] as const) {
    assert.equal(run({ input: "hi" }, sys(mode), "openai-responses").body.instructions, "OP-SYS");
  }
});

test("responses system: replace also removes system/developer input items", () => {
  const body = {
    input: [
      { role: "developer", content: "DEV" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "u" }] },
    ],
  };
  const out = run(body, sys("replace"), "openai-responses").body;
  assert.equal(out.instructions, "OP-SYS");
  assert.deepEqual(out.input, [body.input[1]]);
});

test("responses user: string input for prepend / append / template", () => {
  assert.equal(run({ input: "Q" }, usr("prepend"), "openai-responses").body.input, "OP-USR\n\nQ");
  assert.equal(run({ input: "Q" }, usr("append"), "openai-responses").body.input, "Q\n\nOP-USR");
  assert.equal(
    run({ input: "Q" }, usr("template", "({{user_prompt}})"), "openai-responses").body.input,
    "(Q)"
  );
});

test("responses user: item array edits only the last user item's input_text parts", () => {
  const image = { type: "input_image", image_url: "https://x/y.png" };
  const body = {
    input: [
      { role: "user", content: "older" },
      { type: "function_call_output", call_id: "c1", output: "42" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "LAST" }, image] },
    ],
  };
  const pre = run(body, usr("prepend"), "openai-responses").body.input;
  assert.deepEqual(pre[2].content, [{ type: "input_text", text: "OP-USR\n\nLAST" }, image]);
  assert.equal(pre[0].content, "older");
  assert.equal(pre[1], body.input[1]);

  const app = run(body, usr("append"), "openai-responses").body.input;
  assert.deepEqual(app[2].content, [{ type: "input_text", text: "LAST\n\nOP-USR" }, image]);

  const tpl = run(body, usr("template", "T {{user_prompt}}"), "openai-responses").body.input;
  assert.deepEqual(tpl[2].content, [{ type: "input_text", text: "T LAST" }, image]);
});

test("responses user: image-only user item gains an input_text part", () => {
  const image = { type: "input_image", image_url: "https://x/y.png" };
  const body = { input: [{ role: "user", content: [image] }] };
  assert.deepEqual(run(body, usr("append"), "openai-responses").body.input[0].content, [
    image,
    { type: "input_text", text: "OP-USR" },
  ]);
});
