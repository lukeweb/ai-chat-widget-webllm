export type InitErrorReason =
  | "webgpu-unavailable"
  | "storage-quota"
  | "network"
  | "gpu-memory"
  | "unknown";

// WebLLM's worker rejects with `err.toString()`, so the error usually arrives as a
// "Name: message" string rather than an Error object. Matching works on that text.
const errorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

const PATTERNS: ReadonlyArray<[InitErrorReason, RegExp]> = [
  ["storage-quota", /QuotaExceededError|quota (has been |was )?exceeded|exceeded the quota/i],
  [
    "gpu-memory",
    /DeviceLostError|device (was|is) lost|out of memory|GPUOutOfMemoryError|\bOOM\b/i,
  ],
  [
    "webgpu-unavailable",
    /WebGPUNotAvailableError|WebGPUNotFoundError|FeatureSupportError|ShaderF16SupportError|WebGPU is unavailable/i,
  ],
  [
    "network",
    /Failed to fetch|\bLoad failed\b|NetworkError|network error|Cannot fetch|Unable to fetch|Request failed|Cache\.add|ERR_INTERNET_DISCONNECTED|ERR_NETWORK/i,
  ],
];

/** Maps a model initialization failure to a reason the UI can explain to the user. */
export const classifyInitError = (error: unknown): InitErrorReason => {
  const text = errorText(error);
  for (const [reason, pattern] of PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return "unknown";
};
