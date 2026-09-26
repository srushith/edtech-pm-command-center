"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FILTER_KEYS } from "@/lib/filters";
import { MODE_COOKIE, MODE_PARAM, parseMode, resolveMode, type Mode } from "@/lib/mode";
import type { EntityType } from "@/lib/search-types";

const ONE_YEAR = 60 * 60 * 24 * 365;

export type RecordFormTarget = { type: EntityType; id: string | null };
/** Records to delete (one, or a bulk selection); onDeleted runs after they're in Trash. */
export type DeleteRequest = { type: EntityType; ids: string[]; onDeleted?: () => void };

type ShellContext = {
  cookieMode: Mode;
  setMode: (mode: Mode) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Editors and owners. UI only: the server checks the role on every write. */
  canEdit: boolean;
  recordForm: RecordFormTarget | null;
  openRecordForm: (type: EntityType, id?: string | null) => void;
  closeRecordForm: () => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (open: boolean) => void;
  /** Bumped after every save so the ⌘K index reloads. */
  searchVersion: number;
  invalidateSearch: () => void;
  /** Opens the delete dialog (editors and owners). */
  deleteRequest: DeleteRequest | null;
  requestDelete: (req: DeleteRequest) => void;
  closeDeleteRequest: () => void;
};

const Ctx = createContext<ShellContext | null>(null);

export function ShellProvider({
  initialMode,
  canEdit,
  children,
}: {
  initialMode: Mode;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [cookieMode, setCookieMode] = useState(initialMode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recordForm, setRecordForm] = useState<RecordFormTarget | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const openRecordForm = useCallback(
    (type: EntityType, id: string | null = null) => {
      if (!canEdit) return;
      setPaletteOpen(false);
      setQuickAddOpen(false);
      setRecordForm({ type, id });
    },
    [canEdit],
  );
  const closeRecordForm = useCallback(() => setRecordForm(null), []);
  const invalidateSearch = useCallback(() => setSearchVersion((v) => v + 1), []);
  const requestDelete = useCallback(
    (req: DeleteRequest) => {
      if (!canEdit || req.ids.length === 0) return;
      setPaletteOpen(false);
      setDeleteRequest(req);
    },
    [canEdit],
  );
  const closeDeleteRequest = useCallback(() => setDeleteRequest(null), []);

  const setMode = useCallback(
    (mode: Mode) => {
      document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
      setCookieMode(mode);
      // Choosing a mode is an explicit preference: drop any shared-link override.
      const url = new URL(window.location.href);
      if (url.searchParams.has(MODE_PARAM)) {
        url.searchParams.delete(MODE_PARAM);
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      }
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({
      cookieMode, setMode, paletteOpen, setPaletteOpen, canEdit,
      recordForm, openRecordForm, closeRecordForm, quickAddOpen, setQuickAddOpen, searchVersion, invalidateSearch,
      deleteRequest, requestDelete, closeDeleteRequest,
    }),
    [
      cookieMode, setMode, paletteOpen, canEdit, recordForm, openRecordForm, closeRecordForm, quickAddOpen, searchVersion, invalidateSearch,
      deleteRequest, requestDelete, closeDeleteRequest,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}

/** Effective mode on this page view. Uses useSearchParams, so render inside <Suspense>. */
export function useMode(): { mode: Mode; overridden: boolean; setMode: (m: Mode) => void } {
  const { cookieMode, setMode } = useShell();
  const urlMode = parseMode(useSearchParams().get(MODE_PARAM));
  return { mode: resolveMode(urlMode, cookieMode), overridden: urlMode != null && urlMode !== cookieMode, setMode };
}

/** Navigate to `href` carrying the current filter params (but not `mode`). */
export function useHrefWithFilters() {
  const params = useSearchParams();
  const pathname = usePathname();
  return useCallback(
    (href: string) => {
      const [path, query = ""] = href.split("?");
      const merged = new URLSearchParams(query);
      for (const key of FILTER_KEYS) {
        const v = params.get(key);
        if (v != null && !merged.has(key)) merged.set(key, v);
      }
      const qs = merged.toString();
      return `${path || pathname}${qs ? `?${qs}` : ""}`;
    },
    [params, pathname],
  );
}
