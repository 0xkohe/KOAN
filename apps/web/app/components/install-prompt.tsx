import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

export function InstallPrompt() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
      setDismissed(false);
    }
    function onInstalled() {
      setPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt || dismissed) return null;

  async function install() {
    await prompt!.prompt();
    await prompt!.userChoice;
    setPrompt(null);
  }

  return (
    <aside className="install-prompt" aria-label={t("installApp")}>
      <img src="/koan.svg" alt="" />
      <div>
        <strong>{t("installApp")}</strong>
        <p>{t("installHelp")}</p>
      </div>
      <button className="button-primary" onClick={() => void install()}>
        <Download size={16} />
        {t("install")}
      </button>
      <button
        className="icon-button"
        aria-label={t("notNow")}
        onClick={() => setDismissed(true)}
      >
        <X size={17} />
      </button>
    </aside>
  );
}

function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
