import { WIDGET_TAG_NAME } from "@/config/appConfig";
import { readEmbedAttributes } from "@/widget/embedAttributes";
import { createWidgetElement } from "@/widget/createWidgetElement";

// Runs once per page: safe even if the script is loaded twice. The chat code is loaded on demand,
// and the model itself is only fetched when the visitor first opens the chat.
const mount = async () => {
  if (!customElements.get(WIDGET_TAG_NAME)) {
    const [{ defineCustomElement }, { default: ChatWidget }] = await Promise.all([
      import("vue"),
      import("@/components/ChatWidget.ce.vue"),
    ]);
    if (!customElements.get(WIDGET_TAG_NAME)) {
      customElements.define(
        WIDGET_TAG_NAME,
        createWidgetElement(defineCustomElement(ChatWidget), {
          // Resolved lazily so the services stay in the on-demand chunk, not in the entry bundle.
          loadContent: async (src) => (await import("@/services/content")).loadContent(src),
          destroyEngine: async () => (await import("@/services/aiEngine")).destroyEngine(),
        })
      );
    }
  }

  if (!document.querySelector(WIDGET_TAG_NAME)) {
    const element = document.createElement(WIDGET_TAG_NAME);
    const { contentSrc, lang } = readEmbedAttributes(document);
    if (contentSrc) element.setAttribute("content-src", contentSrc);
    if (lang) element.setAttribute("lang", lang);
    document.body.appendChild(element);
  }
};

const start = () => {
  mount().catch((error: unknown) => {
    console.error("[ai-widget] failed to mount the chat widget", error);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
