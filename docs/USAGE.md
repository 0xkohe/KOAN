# Using KOAN

Start with the [README quick start](../README.md#quick-start) for installation.

## Pair a device

Connect both devices to the same tailnet. Open the HTTPS URL printed by
Tailscale Serve, scan KOAN's QR code, or enter the eight-digit code from the
Gateway terminal. QR pairing fills in the code; submit the pairing form to finish.
Codes are single-use and expire after ten minutes. Restart the Gateway for a new
code, or generate one from Settings on a paired device.

Each paired browser receives a device cookie. A home-screen installation may
need its own pairing, depending on the browser. Settings lists paired devices
and lets you revoke them. Signing out revokes the current device session.

## Connect a project

Open **Projects** and choose a starting location. Browse folders, move up a level,
or filter names in the current folder. You can also enter an absolute path and
select **Open**. Give the project an optional display name and select **Connect project**.

Folders must exist under `KOAN_ALLOWED_ROOTS`. Hidden folders are excluded from
the browser. Real paths are checked, so a symlink cannot bypass the allowed roots.
The picker returns up to 500 folders at a time; use an explicit path if needed.
Connecting a project registers an existing folder; it does not clone a repository.

## Work with an agent

Choose **New session**, a project, and an agent. Select a model or mode when the
agent supplies these options, or leave the defaults. Keep auto-approval off when
you want to review the agent's permission requests.

Send a message with the send button or Enter; Shift+Enter inserts a new line.
The timeline shows responses, tool activity, and expandable reasoning when an
agent emits it. Respond to questions and approval sheets to let the turn continue.
Available approval choices depend on the agent. Use Stop to cancel a turn.

Turns in the same project share a FIFO queue. Different projects can run at the
same time. Closing the tab does not cancel a task. Reopening the session restores
history and resumes the live event stream. A host restart interrupts running work;
KOAN never resubmits interrupted prompts automatically.

### Attachments

Use the paperclip to attach up to five files per turn:

| Type | Maximum size per file |
| --- | --- |
| PNG, JPEG, WebP, GIF | 10 MiB |
| UTF-8 text, JSON, XML | 2 MiB |

Attachments are stored under the data directory. How an agent uses them depends
on its adapter and capabilities. Remove unwanted drafts with the attachment's
remove button. Unused draft attachments are cleaned up after 24 hours.

### Review changes

Select **Working tree diff** in the session header. This shows the project's Git
working-tree changes, not a patch isolated to that session. Review changes on the
host before committing them, especially when other tools also edit the project.

## Configuration

`pnpm run setup` creates `.env.koan` without overwriting an existing file.
The production launcher reads this file; existing process environment variables
take precedence. Restart the Gateway after changing configuration.

| Variable | Default with `pnpm start` | Purpose |
| --- | --- | --- |
| `KOAN_ALLOWED_ROOTS` | KOAN checkout | Absolute directories the Gateway permits as project roots |
| `KOAN_DATA_DIR` | `<checkout>/.koan` | SQLite history, device records, and attachments |
| `KOAN_PUBLIC_URL` | Detected from Tailscale Serve | HTTPS base URL used in the pairing QR code |
| `KOAN_PORT` | `18787` | Gateway port; update the Tailscale Serve target if changed |
| `KOAN_DEFAULT_PROJECT_PATH` | First allowed root | Initial folder opened by the project picker |
| `KOAN_INSECURE_COOKIE` | Off | Set to `1` only for localhost development; `pnpm dev` sets it |

Use plain `KEY=value` lines with unquoted absolute paths. The production launcher
does not expand `~`, `$HOME`, quoted strings, or inline comments. Multiple roots
use the platform path delimiter (`:` on Linux/macOS).

`KOAN_HOST` and `KOAN_WEB_DIR` are internal Gateway options. Normal startup is
intended for `127.0.0.1`; its network grant is scoped to that address. The launcher
sets the web directory to `apps/web/build/client`.

### Unrestricted mode

```bash
pnpm start:unrestricted
```

This explicitly grants all Deno permissions and permits project selection from
the filesystem root for that run. The picker initially opens at the KOAN checkout.
Prefer configuring allowed roots for normal use. Child agents' own permissions
remain a separate concern; see [SECURITY.md](../SECURITY.md).

## Install on your phone

Open KOAN through its HTTPS tailnet URL. Use the browser's install prompt when
available, or its **Add to Home Screen** action. The installed app uses the same
Gateway. It needs a network connection for sessions; caching the app shell does
not provide offline agent execution.

## Update and back up

Stop KOAN before updating or copying its data:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Back up the entire `KOAN_DATA_DIR` while the Gateway is stopped, plus `.env.koan`
if you need to preserve configuration. Store backups privately: they contain
conversation history, attachments, and device records. Back up project files
separately. Deleting the data directory removes KOAN's history and pairing state.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Pairing fails on `http://127.0.0.1:18787` | Production cookies require HTTPS. Use the Tailscale URL, or `pnpm dev` for localhost development. |
| No pairing QR code | Run `tailscale serve status`; ensure the route targets KOAN's port. Restart KOAN after setting up Serve, or set `KOAN_PUBLIC_URL`. |
| Phone cannot reach KOAN | Both devices must be connected to the tailnet; check tailnet access rules, the host's power state, and that KOAN is running. |
| Pairing code rejected | It may have expired or already been used. Generate a new one in Settings or restart the Gateway. |
| Project folder rejected | Use an existing absolute path under an allowed root; restart after changing roots. Check symlink targets. |
| Agent unavailable | Check the executable is on the Gateway process's `PATH`, then restart. For OpenCode, either executable alias is accepted. |
| Agent listed but turns fail | Authenticate the agent on the host, check provider configuration and CLI protocol compatibility, and inspect the Gateway error. |
| Permission denied | Check the configured roots and host filesystem permissions. Install agents before starting KOAN so their executables enter the launcher allowlist. |
| Web build not found | Run `pnpm build` from the repository root. |
| Port already in use | Stop the other process or set `KOAN_PORT` and update Tailscale Serve. For development, Vite's proxy expects port 18787. |
| Session is interrupted | The Gateway restarted. Review the state of the project before sending a follow-up task. |

For a bug report, include your KOAN commit, runtime versions, agent version,
reproduction steps, and redacted logs. Use [GitHub issues](https://github.com/0xkohe/KOAN/issues)
for ordinary bugs and [private reporting](../SECURITY.md) for vulnerabilities.
