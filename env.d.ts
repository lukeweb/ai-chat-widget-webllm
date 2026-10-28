/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "*.ce.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
interface ImportMetaEnv {
  readonly VITE_MODEL_ID: string;
  readonly VITE_MAX_HISTORY_MESSAGES: string;
  readonly VITE_TEASER_DELAY_MS: string;
  readonly VITE_TEASER_VISIBLE_MS: string;
  readonly VITE_WIDGET_TAG_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
