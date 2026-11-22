import { parsePositiveInteger } from "@/config/parsePositiveInteger";
import { parseCustomElementName, parseNonEmptyString } from "@/config/parseString";

export interface RawAppEnv {
  readonly VITE_MODEL_ID?: string;
  readonly VITE_MAX_HISTORY_MESSAGES?: string;
  readonly VITE_TEASER_DELAY_MS?: string;
  readonly VITE_TEASER_VISIBLE_MS?: string;
  readonly VITE_WIDGET_TAG_NAME?: string;
}

export interface AppConfig {
  MODEL_ID: string;
  MAX_HISTORY_MESSAGES: number;
  TEASER_DELAY_MS: number;
  TEASER_VISIBLE_MS: number;
  WIDGET_TAG_NAME: string;
}

// Defaults apply when a VITE_ variable is absent (for example when the gitignored .env is missing).
// A variable that is set to an invalid value still fails loudly.
export const createAppConfig = (env: RawAppEnv): AppConfig => ({
  MODEL_ID: parseNonEmptyString(
    "VITE_MODEL_ID",
    env.VITE_MODEL_ID,
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"
  ),
  MAX_HISTORY_MESSAGES: parsePositiveInteger(
    "VITE_MAX_HISTORY_MESSAGES",
    env.VITE_MAX_HISTORY_MESSAGES,
    12
  ),
  TEASER_DELAY_MS: parsePositiveInteger("VITE_TEASER_DELAY_MS", env.VITE_TEASER_DELAY_MS, 800),
  TEASER_VISIBLE_MS: parsePositiveInteger(
    "VITE_TEASER_VISIBLE_MS",
    env.VITE_TEASER_VISIBLE_MS,
    10000
  ),
  WIDGET_TAG_NAME: parseCustomElementName(
    "VITE_WIDGET_TAG_NAME",
    env.VITE_WIDGET_TAG_NAME,
    "ai-chat-widget"
  ),
});
