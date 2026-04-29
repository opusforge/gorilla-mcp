# Security policy

## Supported versions

We patch security issues on the latest minor release on `main`. Older versions are not maintained.

## Reporting a vulnerability

Please email **gorilla@opusforge.com.br** with a clear description of the issue, reproduction steps, and the minimum impact scope you're confident about.

We will acknowledge receipt within 48 hours and aim to ship a fix within 7 days for critical issues. For non-critical issues we will agree on a disclosure timeline with you before publishing.

Do not open a public GitHub issue for vulnerabilities. Use the email address above so we can coordinate a fix and credit you on disclosure.

## Scope

This server's only network calls are to `gorilla.opusforge.com.br` (auto-config + Edge Functions) and the configured Supabase project. The server requires a valid `GORILLA_API_KEY`, which is hashed at rest in the upstream API. Without that key the server starts and advertises tools but every call returns an auth-required error.

Out of scope:
- Issues that require the host machine to already be compromised.
- Misconfiguration of the user's MCP client (Claude Code / Cursor / etc.).
- Reports against the upstream Gorilla API. Email those separately to the same address.
