import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Folder,
  Link2,
  LoaderCircle,
  MonitorDown,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { readBookmarks, toUrlList, type BookmarkEntry } from "../../lib/bookmarks";
import { copyText } from "../../lib/clipboard";
import { t } from "../../lib/i18n";

type LoadState = "loading" | "ready" | "error";
type CopyState = "idle" | "copied" | "error";

const WEBSITE_URL = "https://www.ncurator.com/zh";

function BookmarkList({ entries }: { entries: BookmarkEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Folder className="h-8 w-8 text-[#A77B4B]" strokeWidth={1.7} />
        <p className="mt-3 text-sm font-semibold text-[#2F2C28]">
          {t("emptyTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#8D8880]">
          {t("emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <ul className="bookmark-list divide-y divide-[#ECE9E3]">
      {entries.map((entry) => (
        <li key={entry.id} className="bookmark-row px-5 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#F1EEE8] text-[#727865]">
              <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              {entry.folderPath ? (
                <p className="truncate text-[11px] leading-4 text-[#A19B92]">
                  {entry.folderPath}
                </p>
              ) : null}
              <p className="truncate text-[13px] font-semibold leading-5 text-[#2F2C28]">
                {entry.title}
              </p>
              <p className="truncate text-[11px] leading-4 text-[#727865]">
                {entry.url}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      setEntries(await readBookmarks());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2200);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const handleCopy = async () => {
    if (entries.length === 0) return;
    try {
      await copyText(toUrlList(entries));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const copyLabel =
    copyState === "copied"
      ? t("copiedCount", String(entries.length))
      : copyState === "error"
        ? t("copyFailed")
        : t("copyAll");

  return (
    <div className="app-shell flex h-[600px] w-[420px] flex-col overflow-hidden bg-[#FBFAF7] text-[#2F2C28]">
      <header className="flex h-16 shrink-0 items-center border-b border-[#E8E5DF] px-5">
        <img src="/icons/icon-48.png" alt="" className="h-9 w-9" />
        <div className="ml-3 min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-5 text-[#1F1F1F]">
            {t("extensionName")}
          </h1>
          <p className="text-[11px] leading-4 text-[#8D8880]">
            {t("browserCompanion")}
          </p>
        </div>
      </header>

      <section className="shrink-0 border-b border-[#E8E5DF] bg-white px-5 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#6F6A62]">
              {t("bookmarkTitle")}
            </p>
            <p className="mt-1 text-[24px] font-semibold leading-none text-[#1F1F1F]">
              {loadState === "ready" ? entries.length : "--"}
              <span className="ml-1.5 text-xs font-medium text-[#8D8880]">
                {t("urlUnit")}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={loadState !== "ready" || entries.length === 0}
            className="copy-button inline-flex h-10 min-w-[146px] items-center justify-center gap-2 rounded-[8px] bg-[#1F1F1F] px-4 text-xs font-semibold text-white shadow-sm outline-none transition focus-visible:ring-4 focus-visible:ring-[#D8D6D1] disabled:cursor-not-allowed disabled:bg-[#C6C2BB]"
          >
            {copyState === "copied" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="max-w-[112px] truncate">{copyLabel}</span>
          </button>
        </div>
      </section>

      <main className="min-h-0 flex-1 bg-white">
        {loadState === "loading" ? (
          <div className="flex h-full flex-col items-center justify-center text-[#8D8880]">
            <LoaderCircle className="h-6 w-6 animate-spin" />
            <p className="mt-3 text-xs">{t("loading")}</p>
          </div>
        ) : loadState === "error" ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <AlertCircle className="h-7 w-7 text-[#A77B4B]" />
            <p className="mt-3 text-sm font-semibold">{t("loadFailed")}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#D8D6D1] bg-white px-3 text-xs font-semibold transition hover:bg-[#F7F5F0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E8E5DF]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("retry")}
            </button>
          </div>
        ) : (
          <BookmarkList entries={entries} />
        )}
      </main>

      <aside className="shrink-0 border-t border-[#E8E5DF] bg-[#F7F5F0] px-5 py-2.5">
        <p className="flex items-center gap-2 text-[11px] leading-4 text-[#6F6A62]">
          <Check className="h-3.5 w-3.5 shrink-0 text-[#2F7C4E]" />
          {t("privacyNote")}
        </p>
      </aside>

      <footer className="shrink-0 bg-[#191C17] px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-white/10 text-[#F2E7D0]">
            <MonitorDown className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{t("desktopTitle")}</p>
            <p className="mt-0.5 truncate text-[11px] text-white/60">
              {t("desktopDescription")}
            </p>
          </div>
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-white/20 px-3 text-[11px] font-semibold transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {t("learnDesktop")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </footer>
    </div>
  );
}

