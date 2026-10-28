import { parsePositiveInteger } from "@/config/parsePositiveInteger";

export const MODEL_ID = import.meta.env.VITE_MODEL_ID;
export const MAX_HISTORY_MESSAGES = parsePositiveInteger(
  "VITE_MAX_HISTORY_MESSAGES",
  import.meta.env.VITE_MAX_HISTORY_MESSAGES
);
export const TEASER_DELAY_MS = parsePositiveInteger(
  "VITE_TEASER_DELAY_MS",
  import.meta.env.VITE_TEASER_DELAY_MS
);
export const TEASER_VISIBLE_MS = parsePositiveInteger(
  "VITE_TEASER_VISIBLE_MS",
  import.meta.env.VITE_TEASER_VISIBLE_MS
);
export const WIDGET_TAG_NAME = import.meta.env.VITE_WIDGET_TAG_NAME;
