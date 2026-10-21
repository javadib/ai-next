-- Per-API-key prompt rewrite (system / last-user prompt proxy).
-- JSON text validated by promptRewriteConfigSchema (open-sse/services/promptRewrite.ts);
-- NULL = no rewrite, which keeps every existing key's behavior unchanged.
ALTER TABLE api_keys ADD COLUMN prompt_rewrite TEXT;
