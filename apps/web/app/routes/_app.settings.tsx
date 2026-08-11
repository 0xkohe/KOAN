import {
  KeyRound,
  Languages,
  Laptop,
  LogOut,
  Moon,
  Smartphone,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useAppData } from "../lib/app-context";
import i18n, { setLocale } from "../lib/i18n";

type Theme = "system" | "light" | "dark";

export default function SettingsPage() {
  const data = useAppData();
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem("koan-theme") as Theme) ?? "system"
  );
  const [devices, setDevices] = useState<
    Array<{ id: string; name: string; lastSeenAt: string }>
  >([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    void api.devices().then((result) => setDevices(result.devices));
  }, []);
  function choose(value: Theme) {
    setTheme(value);
    localStorage.setItem("koan-theme", value);
  }
  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <span className="eyebrow">KOAN</span>
          <h1>{t("settings")}</h1>
          <p>Preferences are stored on this device.</p>
        </div>
      </header>
      <section className="settings-group">
        <h2>{t("appearance")}</h2>
        <div className="segmented">
          <button
            className={theme === "system" ? "active" : ""}
            onClick={() => choose("system")}
          >
            <Laptop size={16} />System
          </button>
          <button
            className={theme === "light" ? "active" : ""}
            onClick={() => choose("light")}
          >
            <Sun size={16} />Light
          </button>
          <button
            className={theme === "dark" ? "active" : ""}
            onClick={() => choose("dark")}
          >
            <Moon size={16} />Dark
          </button>
        </div>
      </section>
      <section className="settings-group">
        <h2>{t("language")}</h2>
        <div className="segmented">
          <button
            className={i18n.language === "en" ? "active" : ""}
            onClick={() => setLocale("en")}
          >
            <Languages size={16} />English
          </button>
          <button
            className={i18n.language === "ja" ? "active" : ""}
            onClick={() => setLocale("ja")}
          >
            <Languages size={16} />日本語
          </button>
        </div>
      </section>
      <section className="settings-group">
        <h2>Device</h2>
        <div className="settings-row">
          <div>
            <strong>{data.auth.device?.name}</strong>
            <p>Paired with this Gateway</p>
          </div>
          <button
            className="button-secondary danger"
            onClick={async () => {
              await api.logout();
              location.assign("/pair");
            }}
          >
            <LogOut size={16} />Sign out
          </button>
        </div>
      </section>
      <section className="settings-group">
        <div className="section-heading">
          <h2>Paired devices</h2>
          <button
            className="button-secondary"
            onClick={async () =>
              setPairingCode((await api.newPairingCode()).code)}
          >
            <KeyRound size={16} />Pair another
          </button>
        </div>
        {pairingCode && (
          <div className="pair-code-panel">
            <span>Use within 10 minutes</span>
            <strong>{pairingCode.slice(0, 4)} {pairingCode.slice(4)}</strong>
          </div>
        )}
        <div className="divide-y divide-hairline">
          {devices.map((device) => (
            <div className="agent-row" key={device.id}>
              <Smartphone size={17} className="text-muted" />
              <div className="flex-1">
                <strong>{device.name}</strong>
                <p>Last seen {new Date(device.lastSeenAt).toLocaleString()}</p>
              </div>
              {device.id !== data.auth.device?.id && (
                <button
                  className="icon-button"
                  aria-label={`Revoke ${device.name}`}
                  onClick={async () => {
                    await api.revokeDevice(device.id);
                    setDevices((items) =>
                      items.filter((item) => item.id !== device.id)
                    );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h2>Agents</h2>
        <div className="divide-y divide-hairline">
          {data.agents.map((agent) => (
            <div className="agent-row" key={agent.id}>
              <span
                className={`status-light ${agent.available ? "available" : ""}`}
              />
              <div>
                <strong>{agent.label}</strong>
                <p>{agent.version ?? agent.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" ||
    theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
}
