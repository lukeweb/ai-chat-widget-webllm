/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mount, type VueWrapper } from "@vue/test-utils";
import { shallowRef } from "vue";
import type { ModelStatus } from "../../src/services/aiEngine";

const status = shallowRef<ModelStatus>({ state: "ready" });
const sendMessage = jest.fn<(text: string, onToken: (t: string) => void) => Promise<unknown>>();
const abort = jest.fn();
const initializeModel = jest.fn<() => Promise<void>>();
const disposeEngine = jest.fn();

jest.mock("../../src/services/aiEngine", () => ({
  modelStatus: status,
  sendMessage: (...args: [string, (t: string) => void]) => sendMessage(...args),
  abort: () => abort(),
  initializeModel: () => initializeModel(),
  disposeEngine: () => disposeEngine(),
}));

import ChatWidget from "../../src/components/ChatWidget.ce.vue";

describe("ChatWidget", () => {
  let wrapper: VueWrapper;

  const mountWidget = () => {
    wrapper = mount(ChatWidget, { attachTo: document.body });
    return wrapper;
  };
  const launcher = () => wrapper.get(".launcher");
  const windowEl = () => wrapper.get(".window");
  const isOpen = () => windowEl().isVisible();

  beforeEach(() => {
    jest.useFakeTimers();
    status.value = { state: "ready" };
    sendMessage.mockReset();
    abort.mockReset();
    initializeModel.mockReset().mockResolvedValue(undefined);
    disposeEngine.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    jest.useRealTimers();
  });

  describe("lifecycle", () => {
    it("does not dispose the shared engine when the element is removed, but aborts generation", () => {
      mountWidget();
      wrapper.unmount();

      expect(disposeEngine).not.toHaveBeenCalled();
      expect(abort).toHaveBeenCalledTimes(1);
    });
  });

  describe("teaser", () => {
    it("shows the teaser after the delay and hides it after the visible time", async () => {
      mountWidget();
      expect(wrapper.find(".teaser").exists()).toBe(false);

      jest.advanceTimersByTime(800);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".teaser").exists()).toBe(true);

      jest.advanceTimersByTime(10000);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".teaser").exists()).toBe(false);
    });

    it("never shows the teaser when the chat was opened before the delay elapsed", async () => {
      mountWidget();
      await launcher().trigger("click");

      jest.advanceTimersByTime(800);
      await launcher().trigger("click"); // close again
      jest.advanceTimersByTime(20000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".teaser").exists()).toBe(false);
    });
  });

  describe("status display", () => {
    it("shows a friendly message instead of the raw error and offers retry", async () => {
      mountWidget();
      status.value = { state: "error", message: "TypeError: GPUAdapter is undefined at foo.js:1" };
      await wrapper.vm.$nextTick();

      const bar = wrapper.get(".model-status");
      expect(bar.text()).not.toContain("GPUAdapter");
      expect(bar.text()).toContain("could not be loaded");

      await bar.get(".retry").trigger("click");
      expect(initializeModel).toHaveBeenCalledTimes(1);
    });

    it("does not duplicate the header status in a status bar while loading or ready", async () => {
      mountWidget();
      expect(wrapper.find(".model-status").exists()).toBe(false);

      status.value = { state: "preparing", progress: 0.5 };
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".model-status").exists()).toBe(false);
      expect(wrapper.get(".status").text()).toContain("50%");
    });
  });

  describe("composer", () => {
    const typeMessage = async (text: string) => {
      await launcher().trigger("click");
      await wrapper.get("textarea").setValue(text);
    };

    it("sends on Enter", async () => {
      mountWidget();
      sendMessage.mockResolvedValue({ text: "ok", truncated: false });
      await typeMessage("hello");

      await wrapper.get("textarea").trigger("keydown", { key: "Enter" });

      expect(sendMessage).toHaveBeenCalledWith("hello", expect.any(Function));
    });

    it("does not send when Enter confirms an IME composition", async () => {
      mountWidget();
      await typeMessage("こんにちは");

      await wrapper.get("textarea").trigger("keydown", { key: "Enter", isComposing: true });
      await wrapper.get("textarea").trigger("keydown", { key: "Enter", keyCode: 229 });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("announces start and the finished reply instead of streaming tokens to the live region", async () => {
      mountWidget();
      let finish!: () => void;
      sendMessage.mockImplementation(
        (_text, onToken) =>
          new Promise((resolve) => {
            onToken("Hel");
            onToken("lo");
            finish = () => resolve({ text: "Hello", truncated: false });
          })
      );
      await typeMessage("hi");
      await wrapper.get("textarea").trigger("keydown", { key: "Enter" });

      expect(wrapper.get(".messages").attributes("aria-live")).toBe("off");
      expect(wrapper.get(".sr-only").text()).toBe("Assistant is typing");

      finish();
      await jest.runAllTimersAsync();
      expect(wrapper.get(".sr-only").text()).toBe("Hello");
    });
  });

  describe("focus management", () => {
    it("focuses the input on open and restores focus to the launcher on close", async () => {
      mountWidget();

      await launcher().trigger("click");
      expect(isOpen()).toBe(true);
      expect(wrapper.get("textarea").element).toBe(document.activeElement);

      await launcher().trigger("click");
      expect(isOpen()).toBe(false);
      expect(launcher().element).toBe(document.activeElement);
    });

    it("closes on Escape and restores focus to the launcher", async () => {
      mountWidget();
      await launcher().trigger("click");

      await windowEl().trigger("keydown", { key: "Escape" });

      expect(isOpen()).toBe(false);
      expect(launcher().element).toBe(document.activeElement);
    });
  });
});
