import { defineCustomElement } from "vue";
import ChatWidget from "@/components/ChatWidget.ce.vue";
import { WIDGET_TAG_NAME } from "@/config/appConfig";

// Runs once: safe even if the script is loaded twice on the same page
const mount = () => {
  if (!customElements.get(WIDGET_TAG_NAME)) {
    customElements.define(WIDGET_TAG_NAME, defineCustomElement(ChatWidget));
  }
  if (!document.querySelector(WIDGET_TAG_NAME)) {
    document.body.appendChild(document.createElement(WIDGET_TAG_NAME));
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
