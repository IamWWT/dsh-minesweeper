/**
 * dsh-minesweeper — 客户端设置 API 适配器（0.1.7 原生）。
 *
 * 旧 0.1.6 的 `settingsScope` 服务已随 0.1.7 移除；本适配器经插件自有
 * REST 端点（/api/dsh-minesweeper/settings*）读写宿主 volatile 字段，
 * 暴露与旧 binder scope 相同的最小面（getSnapshot/subscribe/set）。
 */

/** 与 settings-card.ts 的 SettingsScopeLike 一致（避免循环依赖，此处为真源）。 */
export interface ApiSettingsScope {
  getSnapshot(): { status?: string; value?: Record<string, unknown>; revision?: number } | null;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
}

export function createApiSettingsScope(baseUrl: string): ApiSettingsScope {
  let snapshot: { status: string; value: Record<string, unknown>; revision: number } = {
    status: "pending",
    value: {},
    revision: 0,
  };
  let lastRevision = 0;
  const listeners = new Set<() => void>();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let disposed = false;

  const emit = (): void => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        /* 单个监听器异常不影响其它 */
      }
    }
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    try {
      const r = await fetch(`${baseUrl}/settings`, { cache: "no-store" });
      if (!r.ok) {
        snapshot = { status: "unavailable", value: {}, revision: lastRevision };
        return;
      }
      const data = (await r.json()) as { value?: Record<string, unknown>; revision?: number };
      lastRevision = typeof data.revision === "number" ? data.revision : lastRevision;
      snapshot = { status: "ok", value: data.value ?? {}, revision: lastRevision };
    } catch {
      snapshot = { status: "unavailable", value: {}, revision: lastRevision };
    }
  };

  const poll = async (): Promise<void> => {
    if (disposed || polling) return;
    polling = true;
    try {
      while (!disposed) {
        const started = Date.now();
        try {
          const r = await fetch(`${baseUrl}/settings/watch?timeoutMs=25000`, { cache: "no-store" });
          if (r.ok) {
            const out = (await r.json()) as { changed?: boolean };
            if (out.changed) {
              await refresh();
              emit();
            }
          }
        } catch {
          /* 网络抖动：下一轮继续 */
        }
        const elapsed = Date.now() - started;
        if (elapsed < 24000) await new Promise((res) => setTimeout(res, Math.min(1500, 25000 - elapsed)));
      }
    } finally {
      polling = false;
    }
  };

  const startPolling = (): void => {
    if (pollTimer || disposed) return;
    pollTimer = setTimeout(() => {
    pollTimer = null;
    void poll();
    }, 50);
  };

  void refresh();
  startPolling();

  return {
    getSnapshot() {
      return { ...snapshot };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      startPolling();
      return () => {
        listeners.delete(listener);
      };
    },
    async set(field: string, value: unknown): Promise<void> {
      const r = await fetch(`${baseUrl}/settings/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [field]: value }, expectedRevision: lastRevision }),
      });
      if (!r.ok) throw new Error(`settings write failed: ${r.status}`);
      await refresh();
      emit();
    },
    async unset(field: string): Promise<void> {
      const r = await fetch(`${baseUrl}/settings/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: [field], expectedRevision: lastRevision }),
      });
      if (!r.ok) throw new Error(`settings unset failed: ${r.status}`);
      await refresh();
      emit();
    },
  };
}