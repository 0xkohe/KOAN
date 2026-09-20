import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      projects: "Projects",
      sessions: "Sessions",
      settings: "Settings",
      newSession: "New session",
      connectProject: "Connect project",
      recentSessions: "Recent sessions",
      noSessions: "No sessions yet",
      messagePlaceholder: "Ask your agent…",
      send: "Send",
      stop: "Stop",
      approve: "Approve",
      deny: "Deny",
      allowSession: "Allow for session",
      agent: "Agent",
      project: "Project",
      path: "Absolute project path",
      chooseFolder: "Choose a folder",
      allowedRoot: "Starting location",
      upOneLevel: "Up one level",
      browsingFolders: "Loading folders…",
      noSubfolders: "No subfolders",
      folderListTruncated: "Only the first 500 folders are shown. Enter a path directly to open another folder.",
      browse: "Open",
      searchFolders: "Filter folders in this location",
      clearSearch: "Clear folder filter",
      noMatchingFolders: "No matching folders",
      pairTitle: "Pair this device",
      pairHelp: "Enter the 8-digit code shown in the Gateway terminal.",
      pair: "Pair device",
      connected: "Connected",
      reconnecting: "Reconnecting",
      appearance: "Appearance",
      language: "Language",
      installApp: "Install KOAN",
      installHelp: "Add KOAN to your home screen for app-like access.",
      install: "Install",
      notNow: "Not now",
    },
  },
  ja: {
    translation: {
      projects: "プロジェクト",
      sessions: "セッション",
      settings: "設定",
      newSession: "新規セッション",
      connectProject: "プロジェクトを接続",
      recentSessions: "最近のセッション",
      noSessions: "まだセッションがありません",
      messagePlaceholder: "エージェントに依頼…",
      send: "送信",
      stop: "停止",
      approve: "許可",
      deny: "拒否",
      allowSession: "セッション中は許可",
      agent: "エージェント",
      project: "プロジェクト",
      path: "プロジェクトの絶対パス",
      chooseFolder: "フォルダを選択",
      allowedRoot: "開始位置",
      upOneLevel: "一つ上へ",
      browsingFolders: "フォルダを読み込み中…",
      noSubfolders: "サブフォルダはありません",
      folderListTruncated: "先頭500件だけを表示しています。別のフォルダはパスを直接入力してください。",
      browse: "開く",
      searchFolders: "この階層のフォルダを絞り込み",
      clearSearch: "絞り込みをクリア",
      noMatchingFolders: "一致するフォルダはありません",
      pairTitle: "この端末をペアリング",
      pairHelp:
        "Gateway のターミナルに表示された8桁のコードを入力してください。",
      pair: "端末を接続",
      connected: "接続済み",
      reconnecting: "再接続中",
      appearance: "外観",
      language: "言語",
      installApp: "KOANをインストール",
      installHelp: "ホーム画面からアプリのように起動できます。",
      install: "インストール",
      notNow: "後で",
    },
  },
};

const stored = typeof localStorage === "undefined"
  ? null
  : localStorage.getItem("koan-locale");
const browserLocale =
  typeof navigator !== "undefined" && navigator.language?.startsWith("ja")
    ? "ja"
    : "en";
void i18n.use(initReactI18next).init({
  resources,
  lng: stored ?? browserLocale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export async function setLocale(locale: "en" | "ja") {
  localStorage.setItem("koan-locale", locale);
  document.documentElement.lang = locale;
  await i18n.changeLanguage(locale);
}

export default i18n;
