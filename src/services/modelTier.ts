/** `full` runs the default model; `lite` runs the smaller model with a narrower prompt. */
export type ModelTier = "full" | "lite";
/** Host preference from the `model-tier` attribute; `auto` lets the device decide. */
export type ModelTierPreference = ModelTier | "auto";

export interface DeviceSignals {
  mobile?: boolean;
  /** Storage the origin may still use (quota minus usage), in bytes. */
  freeStorageBytes?: number;
  /** `navigator.deviceMemory`, in GB (coarse, Chromium only). */
  deviceMemoryGb?: number;
}

// The full model needs about 0.9 GB of cache space; below this the download is likely to fail.
export const LITE_FREE_STORAGE_BYTES = 1.2 * 1024 ** 3;
// Devices reporting this much memory or less rarely fit the full model in GPU memory.
export const LITE_DEVICE_MEMORY_GB = 4;

export const parseModelTierPreference = (value: string | null | undefined): ModelTierPreference => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "full" || normalized === "lite" ? normalized : "auto";
};

/**
 * Chooses the model tier. An explicit host preference wins; otherwise mobile or low-resource
 * devices get the lite tier. Missing signals never force the lite tier.
 */
export const selectModelTier = (
  preference: ModelTierPreference,
  signals: DeviceSignals
): ModelTier => {
  if (preference !== "auto") return preference;
  if (signals.mobile) return "lite";
  if (signals.freeStorageBytes !== undefined && signals.freeStorageBytes < LITE_FREE_STORAGE_BYTES) {
    return "lite";
  }
  if (signals.deviceMemoryGb !== undefined && signals.deviceMemoryGb <= LITE_DEVICE_MEMORY_GB) {
    return "lite";
  }
  return "full";
};

const MOBILE_USER_AGENT = /Android|iPhone|iPod|Mobile/i;

interface NavigatorWithHints {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
  storage?: { estimate?: () => Promise<StorageEstimate> };
}

const isMobile = (nav: NavigatorWithHints): boolean => {
  if (typeof nav.userAgentData?.mobile === "boolean" && nav.userAgentData.mobile) return true;
  if (MOBILE_USER_AGENT.test(nav.userAgent ?? "")) return true;
  // iPadOS reports a desktop Mac user agent; a touch-capable "Mac" is an iPad.
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
};

const readFreeStorage = async (nav: NavigatorWithHints): Promise<number | undefined> => {
  try {
    const estimate = await nav.storage?.estimate?.();
    if (estimate?.quota === undefined) return undefined;
    return Math.max(0, estimate.quota - (estimate.usage ?? 0));
  } catch {
    return undefined;
  }
};

/** Reads device signals from the browser; every unavailable signal is left undefined. */
export const readDeviceSignals = async (): Promise<DeviceSignals> => {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as unknown as NavigatorWithHints;
  const signals: DeviceSignals = { mobile: isMobile(nav) };
  const freeStorageBytes = await readFreeStorage(nav);
  if (freeStorageBytes !== undefined) signals.freeStorageBytes = freeStorageBytes;
  if (typeof nav.deviceMemory === "number") signals.deviceMemoryGb = nav.deviceMemory;
  return signals;
};
