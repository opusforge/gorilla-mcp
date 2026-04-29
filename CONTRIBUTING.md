# Contributing

Thanks for considering a contribution. This is a small project, so the workflow stays light.

## Workflow

1. Open an issue first describing the bug or improvement.
2. Branch from `main`, name it `fix/<short-thing>` or `feat/<short-thing>`.
3. Run `npm install && npm run build` locally and confirm there are no TS errors.
4. Open a PR with `Closes #N` in the body so the issue auto-closes on merge.
5. Keep PRs focused. One concern per PR is easier to review and revert.

## Development

```bash
npm install
npm run build           # tsc to dist/
npm run dev             # tsx src/index.ts (no compilation step)
GORILLA_API_KEY=grla_... node dist/index.js   # smoke test
```

The MCP server speaks JSON-RPC over stdio. To test introspection by hand:

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"local","version":"1"}}}'; \
 sleep 0.3; \
 echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'; \
 sleep 0.2; \
 echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'; \
 sleep 0.5) | node dist/index.js
```

You should see `serverInfo` then a `tools/list` response with all 9 tools.

## What we look for

- Tight scope. No drive-by refactors.
- Real fixes for real problems. Issues filed before PRs.
- Founder voice in any user-facing text. Short sentences, no LLM filler, no em-dashes used as decoration.
- Honest commits. Squash if needed but don't rewrite shared history.

## Security

Don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
