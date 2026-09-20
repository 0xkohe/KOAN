import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { redirect, useNavigate } from "react-router";
import { Brand } from "../components/brand";
import { api } from "../lib/api";

export async function clientLoader() {
  const status = await api.authStatus();
  if (status.paired) throw redirect("/");
  return status;
}

export default function PairPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => pairingCodeFromHash(globalThis.location?.hash ?? ""));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      setName(
        /iPhone|iPad/.test(navigator.userAgent)
          ? "iPhone"
          : /Android/.test(navigator.userAgent)
          ? "Android"
          : "Browser",
      ),
    [],
  );
  useEffect(() => {
    if (!pairingCodeFromHash(window.location.hash)) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.pair(code.replace(/\D/g, ""), name);
      navigate("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pair-page">
      <div className="pair-brand">
        <Brand />
      </div>
      <section className="pair-card">
        <span className="pair-icon">
          <KeyRound size={24} />
        </span>
        <span className="eyebrow">Private connection</span>
        <h1>{t("pairTitle")}</h1>
        <p>{t("pairHelp")}</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="field">
            <span>Pairing code</span>
            <input
              className="code-input"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="0000 0000"
              required
              pattern="[0-9]{8}"
            />
          </label>
          <label className="field">
            <span>Device name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button
            className="button-primary w-full justify-center"
            disabled={busy || code.length !== 8}
          >
            {busy ? "Pairing…" : t("pair")}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="privacy-note">
          <ShieldCheck size={17} />
          <span>Your code and sessions stay inside your tailnet.</span>
        </div>
      </section>
    </main>
  );
}

export function pairingCodeFromHash(hash: string) {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("code") ?? "";
  return value.replace(/\D/g, "").slice(0, 8);
}
