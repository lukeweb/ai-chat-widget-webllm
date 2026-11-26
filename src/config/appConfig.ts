import { createAppConfig } from "@/config/createAppConfig";

const config = createAppConfig(import.meta.env);

export const MODEL_ID = config.MODEL_ID;
export const MAX_HISTORY_MESSAGES = config.MAX_HISTORY_MESSAGES;
export const TEASER_DELAY_MS = config.TEASER_DELAY_MS;
export const TEASER_VISIBLE_MS = config.TEASER_VISIBLE_MS;
export const WIDGET_TAG_NAME = config.WIDGET_TAG_NAME;
export const MAX_OUTPUT_TOKENS = config.MAX_OUTPUT_TOKENS;
export const MAX_INPUT_CHARS = config.MAX_INPUT_CHARS;
export const MAX_HISTORY_CHARS = config.MAX_HISTORY_CHARS;
export const MODEL_SIZE_HINT = config.MODEL_SIZE_HINT;
export const LITE_MODEL_ID = config.LITE_MODEL_ID;
export const LITE_MODEL_SIZE_HINT = config.LITE_MODEL_SIZE_HINT;
export const LITE_CONTEXT_WINDOW = config.LITE_CONTEXT_WINDOW;
