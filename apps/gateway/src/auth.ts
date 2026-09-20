import qrcode from "qrcode-terminal";
import type { GatewayConfig } from "./config.ts";
import type { Store } from "./db.ts";

export type Device = { id: string; name: string };

export class PairingAuth {
  #code = createCode();
  #expiresAt = Date.now() + 10 * 60_000;
  #used = false;
  #attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(private store: Store, private config: GatewayConfig) {}

  pairingInfo() {
    return { required: true, expiresAt: new Date(this.#expiresAt).toISOString() };
  }

  printCode() {
    console.log(`\n  KOAN pairing code: ${this.#code}\n  Expires in 10 minutes.\n`);
    if (!this.config.publicUrl) return;

    const pairingUrl = createPairingUrl(this.config.publicUrl, this.#code);
    console.log("  Scan with a phone connected to your tailnet:\n");
    qrcode.generate(pairingUrl, { small: true });
    console.log(`  ${this.config.publicUrl}\n`);
  }

  newPairingCode() {
    this.#code = createCode();
    this.#expiresAt = Date.now() + 10 * 60_000;
    this.#used = false;
    this.printCode();
    return { code: this.#code, expiresAt: new Date(this.#expiresAt).toISOString() };
  }

  async pair(
    code: string,
    name: string,
    clientKeys: string[],
  ): Promise<{ cookie: string; device: Device } | null> {
    this.rateLimit(clientKeys);
    if (this.#used || Date.now() > this.#expiresAt || code !== this.#code) return null;
    this.#used = true;
    const token = randomToken();
    const hash = await sha256(token);
    const device = {
      ...this.store.createDevice(name.slice(0, 80) || "Mobile device", hash),
      name: name.slice(0, 80) || "Mobile device",
    };
    return { cookie: this.cookie(token), device };
  }

  async authenticate(request: Request): Promise<Device | null> {
    const token = readCookie(request.headers.get("cookie") ?? "", this.config.cookieName);
    if (!token) return null;
    return this.store.deviceByHash(await sha256(token));
  }

  clearCookie() {
    return `${this.config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
      this.config.secureCookies ? "; Secure" : ""
    }`;
  }

  private cookie(token: string) {
    return `${this.config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
      90 * 24 * 60 * 60
    }${this.config.secureCookies ? "; Secure" : ""}`;
  }

  private rateLimit(keys: string[]) {
    const now = Date.now();
    pruneExpiredAttempts(this.#attempts, now);
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.some((key) => (this.#attempts.get(key)?.count ?? 0) >= 8)) {
      throw new Error("RATE_LIMITED");
    }
    for (const key of uniqueKeys) {
      const state = this.#attempts.get(key);
      if (state) state.count++;
      else this.#attempts.set(key, { count: 1, resetAt: now + 60_000 });
    }
  }
}

export function createPairingUrl(publicUrl: string, code: string) {
  const url = new URL("pair", publicUrl);
  url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}

export function pruneExpiredAttempts(
  attempts: Map<string, { count: number; resetAt: number }>,
  now: number,
) {
  for (const [key, state] of attempts) {
    if (state.resetAt <= now) attempts.delete(key);
  }
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, "0");
}

function readCookie(header: string, name: string) {
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
