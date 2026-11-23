/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { defineCustomElement, shallowRef } from "vue";

jest.mock("../../src/services/aiEngine", () => ({
  modelStatus: shallowRef({ state: "idle" }),
  isGenerating: shallowRef(false),
  sendMessage: jest.fn(),
  abort: jest.fn(),
  startEngine: jest.fn(),
  startNewChat: jest.fn(),
  initializeModel: jest.fn(),
  destroyEngine: jest.fn(),
}));

import ChatWidget from "../../src/components/ChatWidget.ce.vue";
import { createWidgetElement } from "../../src/widget/createWidgetElement";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("widget element with the real Vue custom element", () => {
  const loadContent = jest.fn<(src?: string) => Promise<void>>().mockResolvedValue(undefined);
  const destroyEngine = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  customElements.define(
    "integration-chat-widget",
    createWidgetElement(defineCustomElement(ChatWidget), { loadContent, destroyEngine })
  );

  afterEach(() => {
    document.body.innerHTML = "";
    loadContent.mockClear();
  });

  it("updates the displayed locale when the lang attribute changes after connecting", async () => {
    const element = document.createElement("integration-chat-widget");
    element.setAttribute("lang", "en");
    document.body.appendChild(element);
    await settle();
    expect(element.shadowRoot?.querySelector(".launcher")?.getAttribute("aria-label")).toBe(
      "Open chat"
    );

    element.setAttribute("lang", "pl");
    await settle();

    expect(element.shadowRoot?.querySelector(".launcher")?.getAttribute("aria-label")).not.toBe(
      "Open chat"
    );
  });

  it("still loads content from content-src on the real element", async () => {
    const element = document.createElement("integration-chat-widget");
    element.setAttribute("content-src", "/kb.json");
    document.body.appendChild(element);
    await settle();

    expect(loadContent).toHaveBeenCalledWith("/kb.json");
  });
});
