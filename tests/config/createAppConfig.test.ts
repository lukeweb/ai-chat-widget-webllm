import { describe, it, expect } from "@jest/globals";
import { createAppConfig } from "../../src/config/createAppConfig";

describe("createAppConfig", () => {
  it("returns the documented defaults when no VITE_ variables are set (missing .env)", () => {
    expect(createAppConfig({})).toEqual({
      MODEL_ID: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      MAX_HISTORY_MESSAGES: 12,
      TEASER_DELAY_MS: 800,
      TEASER_VISIBLE_MS: 10000,
      WIDGET_TAG_NAME: "ai-chat-widget",
      MAX_OUTPUT_TOKENS: 512,
      MAX_INPUT_CHARS: 1000,
      MAX_HISTORY_CHARS: 6000,
      MODEL_SIZE_HINT: "about 1 GB",
    });
  });

  it("uses provided values", () => {
    expect(
      createAppConfig({
        VITE_MODEL_ID: "my-model",
        VITE_MAX_HISTORY_MESSAGES: "4",
        VITE_TEASER_DELAY_MS: "100",
        VITE_TEASER_VISIBLE_MS: "200",
        VITE_WIDGET_TAG_NAME: "my-chat",
        VITE_MAX_OUTPUT_TOKENS: "64",
        VITE_MAX_INPUT_CHARS: "200",
        VITE_MAX_HISTORY_CHARS: "3000",
        VITE_MODEL_SIZE_HINT: "2 GB",
      })
    ).toEqual({
      MODEL_ID: "my-model",
      MAX_HISTORY_MESSAGES: 4,
      TEASER_DELAY_MS: 100,
      TEASER_VISIBLE_MS: 200,
      WIDGET_TAG_NAME: "my-chat",
      MAX_OUTPUT_TOKENS: 64,
      MAX_INPUT_CHARS: 200,
      MAX_HISTORY_CHARS: 3000,
      MODEL_SIZE_HINT: "2 GB",
    });
  });

  it.each([
    [{ VITE_MODEL_ID: " " }, "VITE_MODEL_ID"],
    [{ VITE_MAX_HISTORY_MESSAGES: "0" }, "VITE_MAX_HISTORY_MESSAGES"],
    [{ VITE_TEASER_DELAY_MS: "abc" }, "VITE_TEASER_DELAY_MS"],
    [{ VITE_TEASER_VISIBLE_MS: "" }, "VITE_TEASER_VISIBLE_MS"],
    [{ VITE_WIDGET_TAG_NAME: "chat" }, "VITE_WIDGET_TAG_NAME"],
    [{ VITE_MAX_OUTPUT_TOKENS: "0" }, "VITE_MAX_OUTPUT_TOKENS"],
    [{ VITE_MAX_INPUT_CHARS: "x" }, "VITE_MAX_INPUT_CHARS"],
    [{ VITE_MAX_HISTORY_CHARS: "-1" }, "VITE_MAX_HISTORY_CHARS"],
    [{ VITE_MODEL_SIZE_HINT: " " }, "VITE_MODEL_SIZE_HINT"],
  ])("fails loudly for an invalid value %j", (env, name) => {
    expect(() => createAppConfig(env)).toThrow(name);
  });
});
