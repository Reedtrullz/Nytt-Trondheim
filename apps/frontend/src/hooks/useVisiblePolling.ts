import { useEffect } from "react";

export function shouldPollWhenVisible({
  enabled,
  hidden,
}: {
  enabled: boolean;
  hidden: boolean;
}): boolean {
  return enabled && !hidden;
}

export function useVisiblePolling({
  enabled = true,
  intervalMs,
  reload,
}: {
  enabled?: boolean;
  intervalMs: number;
  reload: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!enabled) return undefined;

    const runIfVisible = () => {
      if (
        shouldPollWhenVisible({
          enabled,
          hidden: typeof document !== "undefined" ? document.hidden : false,
        })
      ) {
        void reload();
      }
    };

    const interval = window.setInterval(runIfVisible, intervalMs);
    const handleVisibilityChange = () => {
      runIfVisible();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, reload]);
}
