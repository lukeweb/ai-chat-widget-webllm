import { defineCustomElement } from "vue";
import ChatWidget from "@/components/ChatWidget.ce.vue";
import { WIDGET_TAG_NAME } from "@/config/appConfig";
import { initializeModel } from "@/services/aiEngine";

const MODEL_INITIALIZATION_STARTED = "__aiChatWidgetModelInitializationStarted__" as const;

// Runs once: safe even if the script is loaded twice on the same page
const mount = () => {
  if (!customElements.get(WIDGET_TAG_NAME)) {
    customElements.define(WIDGET_TAG_NAME, defineCustomElement(ChatWidget));
  }
  if (!document.querySelector(WIDGET_TAG_NAME)) {
    document.body.appendChild(document.createElement(WIDGET_TAG_NAME));
  }

  const windowWithWidgetState = window as Window &
    Partial<Record<typeof MODEL_INITIALIZATION_STARTED, boolean>>;
  if (!windowWithWidgetState[MODEL_INITIALIZATION_STARTED]) {
    windowWithWidgetState[MODEL_INITIALIZATION_STARTED] = true;
    void initializeModel().catch(() => {
      // The service records and logs the actual error; the widget presents it to the user.
    });
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
