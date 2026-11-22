import { createAppConfig } from "@/config/createAppConfig";

const config = createAppConfig(import.meta.env);

export const MODEL_ID = config.MODEL_ID;
export const MAX_HISTORY_MESSAGES = config.MAX_HISTORY_MESSAGES;
export const TEASER_DELAY_MS = config.TEASER_DELAY_MS;
export const TEASER_VISIBLE_MS = config.TEASER_VISIBLE_MS;
export const WIDGET_TAG_NAME = config.WIDGET_TAG_NAME;
