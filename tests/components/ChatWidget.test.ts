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
const startEngine = jest.fn<() => Promise<void>>();
const startNewChat = jest.fn<() => Promise<void>>();
const isGenerating = shallowRef(false);
const disposeEngine = jest.fn();
const destroyEngine = jest.fn();

jest.mock("../../src/services/aiEngine", () => ({
  modelStatus: status,
  sendMessage: (...args: [string, (t: string) => void]) => sendMessage(...args),
  abort: () => abort(),
  isGenerating,
  startEngine: () => startEngine(),
  startNewChat: () => startNewChat(),
  disposeEngine: () => disposeEngine(),
  destroyEngine: () => destroyEngine(),
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
    startEngine.mockReset().mockResolvedValue(undefined);
    startNewChat.mockReset().mockResolvedValue(undefined);
    isGenerating.value = false;
    disposeEngine.mockReset();
    destroyEngine.mockReset();
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
      expect(destroyEngine).not.toHaveBeenCalled();
      expect(abort).toHaveBeenCalledTimes(1);
    });
  });

  describe("engine startup", () => {
    it("does not start the engine on mount and starts it once on first open", async () => {
      status.value = { state: "idle" };
      mountWidget();
      expect(startEngine).not.toHaveBeenCalled();

      await launcher().trigger("click");
      expect(startEngine).toHaveBeenCalledTimes(1);

      await launcher().trigger("click"); // close
      await launcher().trigger("click"); // reopen
      expect(startEngine).toHaveBeenCalledTimes(1);
    });

    it("does not surface a rejected startEngine call", async () => {
      startEngine.mockRejectedValue(new Error("boom"));
      mountWidget();

      await launcher().trigger("click");
      await jest.runAllTimersAsync();

      expect(isOpen()).toBe(true);
    });

    it("shows the download size hint while idle", () => {
      status.value = { state: "idle" };
      mountWidget();

      expect(wrapper.get(".status").text()).toBe(
        "The model downloads when you open the chat (about 1 GB)"
      );
    });
  });

  describe("teaser", () => {
    it("is scheduled on mount even while the model is idle", async () => {
      status.value = { state: "idle" };
      mountWidget();

      jest.advanceTimersByTime(800);
      await wrapper.vm.$nextTick();

      expect(wrapper.get(".teaser").text()).toBe("Hello! Have a question? I'm happy to help.");
    });

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
      expect(startEngine).toHaveBeenCalledTimes(1);
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

  describe("new chat", () => {
    const newChatButton = () => wrapper.get('button[aria-label="New chat"]');
    const send = async (text: string) => {
      await launcher().trigger("click");
      await wrapper.get("textarea").setValue(text);
      await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
    };
    const bubbles = () => wrapper.findAll(".bubble").map((b) => b.text());

    it("clears the messages to the greeting and resets the service", async () => {
      mountWidget();
      sendMessage.mockImplementation(async (_text, onToken) => {
        onToken("Answer");
        return { text: "Answer", truncated: false };
      });
      await send("Question");
      await jest.runAllTimersAsync();
      expect(bubbles()).toEqual(["Hello! How can I help?", "Question", "Answer"]);

      await newChatButton().trigger("click");
      await jest.runAllTimersAsync();

      expect(startNewChat).toHaveBeenCalledTimes(1);
      expect(bubbles()).toEqual(["Hello! How can I help?"]);
    });

    it("ignores tokens and the result of a send that was in flight during the reset", async () => {
      mountWidget();
      let emit!: (token: string) => void;
      let finish!: () => void;
      sendMessage.mockImplementation(
        (_text, onToken) =>
          new Promise((resolve) => {
            emit = onToken;
            finish = () => resolve({ text: "late", truncated: false });
          })
      );
      await send("Question");

      await newChatButton().trigger("click");
      await jest.runAllTimersAsync();
      emit("late");
      finish();
      await jest.runAllTimersAsync();

      expect(bubbles()).toEqual(["Hello! How can I help?"]);
      expect(wrapper.get(".sr-only").text()).toBe("");
    });

    it("ignores an error from a send that was in flight during the reset", async () => {
      mountWidget();
      let fail!: (error: Error) => void;
      sendMessage.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          })
      );
      await send("Question");

      await newChatButton().trigger("click");
      await jest.runAllTimersAsync();
      fail(new Error("aborted"));
      await jest.runAllTimersAsync();

      expect(bubbles()).toEqual(["Hello! How can I help?"]);
    });

    it("disables the button while the reset is in progress", async () => {
      mountWidget();
      let finishReset!: () => void;
      startNewChat.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishReset = resolve;
          })
      );
      await launcher().trigger("click");

      await newChatButton().trigger("click");
      expect(newChatButton().attributes("disabled")).toBeDefined();
      await newChatButton().trigger("click");
      expect(startNewChat).toHaveBeenCalledTimes(1);

      finishReset();
      await jest.runAllTimersAsync();
      expect(newChatButton().attributes("disabled")).toBeUndefined();
    });
  });

  describe("input limit and send errors", () => {
    const sendWithError = async (name: string) => {
      const error = new Error("details");
      error.name = name;
      sendMessage.mockRejectedValue(error);
      await launcher().trigger("click");
      await wrapper.get("textarea").setValue("hi");
      await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
      await jest.runAllTimersAsync();
      return wrapper.findAll(".bubble").map((b) => b.text());
    };

    it("limits the textarea to the configured number of characters", () => {
      mountWidget();

      expect(wrapper.get("textarea").attributes("maxlength")).toBe("1000");
    });

    it("maps InputTooLongError to the message-too-long text", async () => {
      mountWidget();

      expect(await sendWithError("InputTooLongError")).toEqual([
        "Hello! How can I help?",
        "hi",
        "Your message is too long. Please shorten it and try again.",
      ]);
    });

    it("maps ContextOverflowError to the conversation-too-long text", async () => {
      mountWidget();

      expect(await sendWithError("ContextOverflowError")).toEqual([
        "Hello! How can I help?",
        "hi",
        "This conversation is too long. Start a new chat to continue.",
      ]);
    });

    it("uses the generic text for any other error without leaking its message", async () => {
      mountWidget();

      expect(await sendWithError("Error")).toEqual([
        "Hello! How can I help?",
        "hi",
        "An error occurred while generating the response.",
      ]);
    });
  });

  describe("localization", () => {
    it("renders Polish texts when lang is pl", () => {
      status.value = { state: "preparing", progress: 0.5 };
      wrapper = mount(ChatWidget, { attachTo: document.body, props: { lang: "pl" } });

      expect(wrapper.get(".bubble").text()).toBe("Cześć! W czym mogę pomóc?");
      expect(wrapper.get(".status").text()).toBe("Przygotowywanie modelu: 50%");
      expect(wrapper.get("textarea").attributes("placeholder")).toBe("Napisz wiadomość…");
      expect(wrapper.get(".launcher").attributes("aria-label")).toBe("Otwórz czat");
      expect(wrapper.find('button[aria-label="Nowy czat"]').exists()).toBe(true);
    });

    it("reacts to changes of the lang prop", async () => {
      wrapper = mount(ChatWidget, { attachTo: document.body, props: { lang: "en" } });
      expect(wrapper.get(".launcher").attributes("aria-label")).toBe("Open chat");

      await wrapper.setProps({ lang: "pl" });

      expect(wrapper.get(".launcher").attributes("aria-label")).toBe("Otwórz czat");
    });
  });
});
