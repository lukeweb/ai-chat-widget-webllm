export interface TeaserScheduler {
  /** Schedules the teaser once; later calls are ignored. */
  schedule: () => void;
  /** Hides the teaser and cancels any pending show or hide. */
  hide: () => void;
  /** Cancels pending timers without touching the visible state. */
  dispose: () => void;
}

export interface TeaserOptions {
  delayMs: number;
  visibleMs: number;
  setVisible: (visible: boolean) => void;
  /** Checked when the delay elapses, so a teaser never appears over an open chat. */
  canShow: () => boolean;
}

export const createTeaserScheduler = ({
  delayMs,
  visibleMs,
  setVisible,
  canShow,
}: TeaserOptions): TeaserScheduler => {
  let scheduled = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = undefined;
    hideTimer = undefined;
  };

  return {
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      showTimer = setTimeout(() => {
        showTimer = undefined;
        if (!canShow()) return;
        setVisible(true);
        hideTimer = setTimeout(() => {
          hideTimer = undefined;
          setVisible(false);
        }, visibleMs);
      }, delayMs);
    },
    hide: () => {
      clearTimers();
      setVisible(false);
    },
    dispose: clearTimers,
  };
};
