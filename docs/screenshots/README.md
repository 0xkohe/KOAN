# Documentation screenshots

These PNGs show the real KOAN UI with fictional API responses and a mocked
WebSocket connection. No agent is launched, and no real project, credential,
pairing code, or conversation is used. The sample assistant's test results are
illustrative content, not evidence of a provider run.

To regenerate from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @koan/web exec vite preview --host 127.0.0.1 --port 5174 --strictPort
```

In another terminal, use [Playwright CLI](https://github.com/microsoft/playwright-cli):

```bash
playwright-cli -s=koan-docs open --config=scripts/screenshots.config.json
playwright-cli -s=koan-docs run-code --filename=scripts/capture-screenshots.js
playwright-cli -s=koan-docs close
```

Install the CLI and its browser if needed, following its installation guide.
The script captures a 1440 × 900 desktop dashboard and three 390 × 844 mobile
views: conversation, command approval, and project picker. It forces English and
light mode. The browser configuration blocks service workers so all API calls
remain intercepted by the demo fixtures. Browser/OS font rendering may differ. Inspect all images before
committing them; keep them consistent with the current UI.
