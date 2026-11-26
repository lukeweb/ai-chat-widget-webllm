import { describe, expect, it } from "@jest/globals";
import { classifyInitError } from "../../src/services/initError";

const named = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe("classifyInitError", () => {
  it.each([
    // WebLLM's worker forwards errors as `err.toString()` strings
    "QuotaExceededError: Quota exceeded.",
    "QuotaExceededError: The quota has been exceeded.",
    named("QuotaExceededError", "Quota exceeded."),
    // A quota failure wrapped in a fetch error is still a storage problem
    "Error: Cannot fetch https://huggingface.co/x/params_shard_12.bin err= QuotaExceededError: Quota exceeded.",
  ])("classifies %p as storage-quota", (error) => {
    expect(classifyInitError(error)).toBe("storage-quota");
  });

  it.each([
    "Error: device is lost",
    "Error: out of memory while allocating weights",
    "GPUOutOfMemoryError: allocation failed",
  ])("classifies additional GPU memory wording %p", (error) => {
    expect(classifyInitError(error)).toBe("gpu-memory");
  });

  it.each([
    "TypeError: Failed to fetch",
    "TypeError: Load failed",
    "TypeError: NetworkError when attempting to fetch resource.",
    "Error: Cannot fetch https://huggingface.co/x/params_shard_3.bin",
    // Chrome's Cache.add() on an HTTP error status (default WebLLM cache backend)
    "TypeError: Failed to execute 'add' on 'Cache': Request failed",
    // WebLLM's OPFS and cross-origin storage cache backends
    "Error: ArtifactOPFSCache: Unable to fetch https://huggingface.co/x/params_shard_3.bin, received status 503",
    new TypeError("Failed to fetch"),
  ])("classifies %p as network", (error) => {
    expect(classifyInitError(error)).toBe("network");
  });

  it.each([
    "DeviceLostError: The WebGPU device was lost while loading the model.",
    "Error: Device was lost. This can happen due to insufficient memory",
    named("GPUOutOfMemoryError", "allocation failed"),
  ])("classifies %p as gpu-memory", (error) => {
    expect(classifyInitError(error)).toBe("gpu-memory");
  });

  it.each([
    "WebGPUNotAvailableError: WebGPU is not supported in your current environment",
    "WebGPUNotFoundError: Cannot find WebGPU in the environment",
    "ShaderF16SupportError: This model requires WebGPU extension shader-f16",
    "FeatureSupportError: This model requires feature subgroups",
    new Error("WebGPU is unavailable or no compatible adapter was found."),
  ])("classifies %p as webgpu-unavailable", (error) => {
    expect(classifyInitError(error)).toBe("webgpu-unavailable");
  });

  it.each([
    new Error("Something unexpected"),
    // "download failed" must not match Safari's "Load failed"
    new Error("download failed"),
    "boom",
    undefined,
    null,
    42,
  ])(
    "falls back to unknown for %p",
    (error) => {
      expect(classifyInitError(error)).toBe("unknown");
    }
  );
});
