import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  LITE_DEVICE_MEMORY_GB,
  LITE_FREE_STORAGE_BYTES,
  parseModelTierPreference,
  readDeviceSignals,
  selectModelTier,
} from "../../src/services/modelTier";

const GB = 1024 ** 3;

describe("parseModelTierPreference", () => {
  it.each([
    ["lite", "lite"],
    ["full", "full"],
    [" LITE ", "lite"],
    ["auto", "auto"],
    ["something", "auto"],
    ["", "auto"],
    [undefined, "auto"],
    [null, "auto"],
  ] as const)("parses %p as %p", (value, expected) => {
    expect(parseModelTierPreference(value)).toBe(expected);
  });
});

describe("selectModelTier", () => {
  it("lets an explicit preference win over every device signal", () => {
    expect(selectModelTier("full", { mobile: true, deviceMemoryGb: 1 })).toBe("full");
    expect(selectModelTier("lite", { mobile: false, freeStorageBytes: 100 * GB })).toBe("lite");
  });

  it.each([
    ["a mobile device", { mobile: true }],
    ["low free storage", { mobile: false, freeStorageBytes: LITE_FREE_STORAGE_BYTES - 1 }],
    ["low device memory", { mobile: false, deviceMemoryGb: LITE_DEVICE_MEMORY_GB }],
  ])("chooses lite for %s", (_label, signals) => {
    expect(selectModelTier("auto", signals)).toBe("lite");
  });

  it("chooses full for a desktop with enough storage and memory", () => {
    expect(
      selectModelTier("auto", {
        mobile: false,
        freeStorageBytes: LITE_FREE_STORAGE_BYTES,
        deviceMemoryGb: 8,
      })
    ).toBe("full");
  });

  it("never forces lite when signals are missing", () => {
    expect(selectModelTier("auto", {})).toBe("full");
  });
});

describe("readDeviceSignals", () => {
  const setNavigator = (value: unknown) =>
    Object.defineProperty(globalThis, "navigator", { value, configurable: true });

  afterEach(() => {
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  it("returns no signals without a navigator", async () => {
    delete (globalThis as { navigator?: Navigator }).navigator;
    expect(await readDeviceSignals()).toEqual({});
  });

  it("reads the client-hint mobile flag, free storage and device memory", async () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Linux)",
      userAgentData: { mobile: true },
      deviceMemory: 4,
      storage: {
        estimate: jest
          .fn<() => Promise<StorageEstimate>>()
          .mockResolvedValue({ quota: 2 * GB, usage: 0.5 * GB }),
      },
    });

    expect(await readDeviceSignals()).toEqual({
      mobile: true,
      freeStorageBytes: 1.5 * GB,
      deviceMemoryGb: 4,
    });
  });

  it.each([
    ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"],
  ])("detects %s from the user agent when client hints are missing", async (_label, userAgent) => {
    setNavigator({ userAgent });
    expect((await readDeviceSignals()).mobile).toBe(true);
  });

  it("detects an iPad that reports a desktop Mac user agent", async () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    expect((await readDeviceSignals()).mobile).toBe(true);
  });

  it("treats a desktop Mac without touch as not mobile", async () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    expect(await readDeviceSignals()).toEqual({ mobile: false });
  });

  it("leaves storage undefined when the estimate rejects or has no quota", async () => {
    setNavigator({
      userAgent: "desktop",
      storage: { estimate: () => Promise.reject(new Error("denied")) },
    });
    expect(await readDeviceSignals()).toEqual({ mobile: false });

    setNavigator({ userAgent: "desktop", storage: { estimate: () => Promise.resolve({}) } });
    expect(await readDeviceSignals()).toEqual({ mobile: false });
  });

  it("does not report negative free storage when usage exceeds the quota", async () => {
    setNavigator({
      userAgent: "desktop",
      storage: { estimate: () => Promise.resolve({ quota: GB, usage: 2 * GB }) },
    });
    expect((await readDeviceSignals()).freeStorageBytes).toBe(0);
  });
});
