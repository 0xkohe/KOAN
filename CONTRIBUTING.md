# Contributing to KOAN

Bug reports, documentation improvements, and focused pull requests are welcome.
For a large feature or a new agent adapter, open an issue to discuss the design first.

## Development

Use Node.js 22.22+, pnpm 10.27.0, and Deno 2.9+ on Linux or macOS. Windows users
should use WSL2; native Windows has not been validated.

```bash
git clone https://github.com/0xkohe/KOAN.git
cd KOAN
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Open `http://127.0.0.1:5173` and pair with the code in the Gateway terminal.
The development Gateway permits an insecure localhost cookie. Use HTTPS through
Tailscale Serve for normal use. Update `KOAN_ALLOWED_ROOTS` in `.env.koan` to work
with repositories outside the KOAN directory.

## Checks

```bash
pnpm lint
pnpm test
pnpm build
pnpm --filter @koan/web exec playwright install chromium
pnpm test:e2e
```

The test suite uses fake agent processes and does not require provider credentials.
`pnpm test:agents` is an optional, separate check of locally installed CLI versions.
It does not validate an authenticated conversation with every provider.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/gateway/src` | Deno HTTP/WebSocket server, SQLite store, scheduling, agent adapters |
| `apps/gateway/tests` | Gateway tests and fake agent fixtures |
| `apps/web/app` | React UI, file-based routes, styles, and UI tests |
| `apps/web/e2e` | Playwright browser tests |
| `packages/protocol` | Shared Zod schemas and TypeScript types |
| `scripts` | Setup, launcher, Tailscale detection, documentation screenshots |
| `docs` | User guide, architecture, and screenshots |

Use the surrounding TypeScript style. Keep routes in `apps/web/app/routes`;
`routes.ts` derives the route tree from filenames. Preserve the shared protocol
when changing the Gateway or UI. Add regression tests for behavior changes,
particularly authentication, path validation, scheduling, and agent protocols.

## Pull requests

Explain the problem, the resulting behavior, and how you tested the change.
Include before/after screenshots for visible UI changes. Keep unrelated edits
separate. Do not commit `.env` files, `.koan` data, pairing codes, credentials,
or screenshots of private projects. See [SECURITY.md](SECURITY.md) for sensitive reports.

Contributions are provided under the project's [MIT license](LICENSE).
