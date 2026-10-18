# Security

KOAN is an early-stage, self-hosted application for one trusted user and their
paired devices. Security fixes target the latest code on the default branch.
Older snapshots do not have a separate support commitment.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/0xkohe/KOAN/security/advisories/new).
Include the affected commit, reproduction steps, impact, and a minimal example
without live credentials or private project data. Do not disclose exploit details
in a public issue. If private reporting is unavailable, open an issue requesting
a private contact channel without including the vulnerability itself.

## Trust boundaries

- Keep the Gateway on `127.0.0.1` and expose it only through Tailscale Serve to
  trusted devices. Public internet hosting and multi-user tenancy are outside
  the supported deployment model.
- Pairing codes are single-use and expire after ten minutes. Device tokens are
  stored as SHA-256 hashes. Revoke lost devices in Settings.
- Mutations check Origin and an application CSRF header. WebSocket upgrades
  require a paired cookie and a matching Origin.
- Project registration resolves real paths under `KOAN_ALLOWED_ROOTS` to reject
  traversal and symlink escapes. This controls Gateway access; it is not an
  operating-system sandbox around the agent.
- The normal launcher grants scoped Deno permissions and disables interactive
  Deno permission prompts. Agent subprocesses inherit the host user's access
  and environment, including provider credentials. Use each agent's own
  permissions and sandbox, and review approval requests.
- Claude read-only tools are automatically allowed unless explicit permission
  rules require approval. Other approval behavior depends on the adapter and
  installed agent version. Session auto-approval is opt-in.
- `pnpm start:unrestricted` grants all Deno permissions and lets the project
  picker browse from the filesystem root. Use it only when you intend that access.
- `KOAN_INSECURE_COOKIE=1` is for localhost development only.

Session history and attachments are stored under `KOAN_DATA_DIR` without
application-level encryption. Protect the host account and backups. The PWA
caches UI assets; live sessions require connectivity. Agent providers receive
whatever data their agents send according to their own configuration and terms.
An open-source KOAN license does not change third-party agent licenses or service terms.
