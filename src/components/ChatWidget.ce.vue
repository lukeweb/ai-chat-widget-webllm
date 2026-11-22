<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { TEASER_DELAY_MS, TEASER_VISIBLE_MS } from "@/config/appConfig";
import { initializeModel, modelStatus, sendMessage, abort } from "@/services/aiEngine";
import { createTeaserScheduler } from "@/services/teaser";

type Msg = { role: "user" | "assistant"; text: string };

const open = ref(false);
const teaser = ref(false);
const input = ref("");
const generating = ref(false);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const launcherEl = ref<HTMLButtonElement | null>(null);
const announcement = ref("");
const messages = ref<Msg[]>([{ role: "assistant", text: "Hello! How can I help?" }]);

const teaserScheduler = createTeaserScheduler({
  delayMs: TEASER_DELAY_MS,
  visibleMs: TEASER_VISIBLE_MS,
  setVisible: (visible) => {
    teaser.value = visible;
  },
  canShow: () => !open.value,
});

const modelStatusLabel = computed(() => {
  switch (modelStatus.value.state) {
    case "idle":
      return "Model has not started loading";
    case "preparing":
      return `Preparing model: ${Math.floor(modelStatus.value.progress * 100)}%`;
    case "initializing":
      return "Preparing the model…";
    case "ready":
      return "Ready to chat";
    case "error":
      return "Model failed to load";
    case "cancelled":
      return "Model initialization was cancelled";
    default:
      return "Model status unavailable";
  }
});

const sendNotice = ref("");
const showStatusBar = computed(
  () =>
    modelStatus.value.state === "error" ||
    modelStatus.value.state === "cancelled" ||
    sendNotice.value !== ""
);
const retryInitialization = async () => {
  sendNotice.value = "";
  try {
    await initializeModel();
  } catch {
    // The manager retains the failure details in modelStatus and logs the original error.
  }
};

watch(
  modelStatus,
  (status) => {
    if (status.state === "ready") sendNotice.value = "";
    if (status.state === "ready") teaserScheduler.schedule();
  },
  { immediate: true }
);

const toggle = async () => {
  open.value = !open.value;
  teaserScheduler.hide();
  await nextTick();
  if (open.value) inputEl.value?.focus();
  else launcherEl.value?.focus();
};

const close = () => {
  if (open.value) void toggle();
};

// Ignore Enter while an IME composition is being confirmed
const onEnter = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void send();
};

const send = async () => {
  const text = input.value.trim();
  if (!text || generating.value) return;
  if (modelStatus.value.state !== "ready") {
    sendNotice.value =
      modelStatus.value.state === "error"
        ? "The model could not be loaded. Retry loading before sending your message."
        : "The model is still preparing. Your message has not been sent.";
    return;
  }
  input.value = "";
  sendNotice.value = "";

  messages.value.push({ role: "user", text });
  messages.value.push({ role: "assistant", text: "" });
  // Take the reactive proxy from the array, mutating a plain object would not update the UI
  const reply = messages.value[messages.value.length - 1];

  if (!reply) return;

  generating.value = true;
  announcement.value = "Assistant is typing";
  try {
    const result = await sendMessage(text, (token) => {
      reply.text += token;
    });
    if (result.aborted) {
      const replyIndex = messages.value.indexOf(reply);
      if (!reply.text && replyIndex !== -1) messages.value.splice(replyIndex, 1);
      announcement.value = "";
      return;
    }
    if (result.truncated) reply.text += " …";
    if (!reply.text) reply.text = "Failed to generate a response.";
    announcement.value = reply.text;
  } catch {
    reply.text ||= "An error occurred while generating the response.";
    announcement.value = reply.text;
  } finally {
    generating.value = false;
  }
};

// Keep the newest message in view while tokens stream in
watch(
  messages,
  () => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  },
  { deep: true, flush: "post" }
);

// The engine is a page-wide singleton: removing or moving the element must not unload the model.
onBeforeUnmount(() => {
  teaserScheduler.dispose();
  abort();
});
</script>

<template>
  <div class="root">
    <Transition name="window">
      <section
        v-show="open"
        class="window"
        role="dialog"
        aria-label="Chat with the assistant"
        @keydown.esc="close"
      >
        <header class="header">
          <div class="avatar" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24">
              <path
                d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
              />
            </svg>
          </div>
          <div class="title">
            <strong>Assistant</strong>
            <span class="status" :class="`model-${modelStatus.state}`">
              <i class="dot"></i>{{ modelStatusLabel }}
            </span>
          </div>
          <button class="icon-btn" aria-label="Close chat" @click="toggle">
            <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <!-- Progress is shown in the header; this bar only carries notices and recovery actions. -->
        <div v-if="showStatusBar" class="model-status" role="status" aria-live="polite">
          <span v-if="modelStatus.state === 'error'">
            The model could not be loaded. Check that your browser supports WebGPU, then retry.
          </span>
          <span v-else-if="modelStatus.state === 'cancelled'">
            Model loading was interrupted.
          </span>
          <span v-else-if="sendNotice">{{ sendNotice }}</span>
          <button
            v-if="modelStatus.state === 'error' || modelStatus.state === 'cancelled'"
            type="button"
            class="retry"
            @click="retryInitialization"
          >
            Retry
          </button>
        </div>

        <div ref="listEl" class="messages" role="log" aria-live="off">
          <div v-for="(m, i) in messages" :key="i" class="row" :class="m.role">
            <div class="bubble">
              <span
                v-if="m.text === '' && generating"
                class="typing"
                aria-label="Assistant is typing"
              >
                <i></i><i></i><i></i>
              </span>
              <template v-else>{{ m.text }}</template>
            </div>
          </div>
        </div>

        <form class="composer" @submit.prevent="send">
          <textarea
            ref="inputEl"
            v-model="input"
            rows="1"
            placeholder="Type a message…"
            aria-label="Message"
            @keydown.enter.exact="onEnter"
          ></textarea>
          <button
            v-if="generating"
            type="button"
            class="send"
            aria-label="Stop generation"
            @click="abort()"
          >
            <svg class="icon icon-fill" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
          <button v-else type="submit" class="send" aria-label="Send" :disabled="!input.trim()">
            <svg class="icon" viewBox="0 0 24 24">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </form>

        <p class="disclaimer">
          The AI assistant runs locally in your browser. Responses may be inaccurate.
        </p>
      </section>
    </Transition>

    <Transition name="pop">
      <div v-if="teaser && !open" class="teaser" role="status">
        <button class="teaser-body" @click="toggle">
          Hello! Have a question? I'm happy to help.
        </button>
        <button class="teaser-close" aria-label="Close tip" @click="teaserScheduler.hide()">
          <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </Transition>

    <!-- Announces generation start and the finished reply instead of every streamed token -->
    <div class="sr-only" role="status" aria-live="polite">{{ announcement }}</div>

    <button
      ref="launcherEl"
      class="launcher"
      :aria-label="open ? 'Close chat' : 'Open chat'"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg v-if="!open" class="icon icon-lg" viewBox="0 0 24 24">
        <path
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        />
      </svg>
      <svg v-else class="icon icon-lg" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  </div>
</template>

<style>
/* Reset everything inherited from the host page */
:host {
  all: initial;
}

.root {
  /* The host page can override the accent: ai-chat-widget { --aiw-accent: #0f766e } */
  --accent: var(--aiw-accent, #2563eb);
  --bg: #ffffff;
  --surface: #f3f4f6;
  --text: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;

  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  font:
    14px/1.5 system-ui,
    -apple-system,
    "Segoe UI",
    Roboto,
    "Helvetica Neue",
    Arial,
    sans-serif;
  color: var(--text);
}

.root *,
.root *::before,
.root *::after {
  box-sizing: border-box;
}

button,
textarea {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.icon {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-lg {
  width: 26px;
  height: 26px;
}

.icon-fill {
  fill: currentColor;
  stroke: none;
}

/* Launcher */
.launcher {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 6px 18px rgba(17, 24, 39, 0.28);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.launcher:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(17, 24, 39, 0.32);
}

/* Teaser bubble */
.teaser {
  position: relative;
  max-width: 260px;
  background: var(--bg);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.18);
}

.teaser::after {
  content: "";
  position: absolute;
  right: 22px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  background: var(--bg);
  transform: rotate(45deg);
  border-radius: 2px;
}

.teaser-body {
  display: block;
  width: 100%;
  padding: 12px 36px 12px 14px;
  border: 0;
  background: none;
  text-align: left;
}

.teaser-close {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--muted);
}

.teaser-close:hover {
  background: var(--surface);
}

.teaser-close .icon {
  width: 14px;
  height: 14px;
}

/* Chat window */
.window {
  display: flex;
  flex-direction: column;
  width: 380px;
  height: min(560px, calc(100vh - 120px));
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(17, 24, 39, 0.22);
  overflow: hidden;
  transform-origin: bottom right;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--accent);
  color: #fff;
}

.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}

.title {
  display: flex;
  flex: 1;
  flex-direction: column;
  line-height: 1.25;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.9;
}

.model-error {
  color: #fee2e2;
}

.model-preparing .dot,
.model-initializing .dot,
.model-idle .dot,
.model-cancelled .dot {
  background: #facc15;
}

.model-error .dot {
  background: #fca5a5;
}

.model-ready .dot {
  background: #4ade80;
}

.model-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.model-status:has(.retry) {
  color: #b91c1c;
}

.retry {
  flex-shrink: 0;
  padding: 3px 9px;
  border: 1px solid currentColor;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 12px;
}

.retry:hover {
  background: var(--surface);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: #fff;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.row {
  display: flex;
}

.row.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 82%;
  padding: 9px 13px;
  border-radius: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.row.assistant .bubble {
  background: var(--surface);
  border-bottom-left-radius: 4px;
}

.row.user .bubble {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
}

.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  animation: blink 1.2s infinite ease-in-out;
}

.typing i:nth-child(2) {
  animation-delay: 0.15s;
}

.typing i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}

.composer textarea {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  max-height: 120px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  resize: none;
  /* Auto-grows in browsers that support it, otherwise stays one line */
  field-sizing: content;
}

.composer textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.send {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
}

.send:disabled {
  opacity: 0.4;
  cursor: default;
}

.disclaimer {
  margin: 0;
  padding: 0 16px 10px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

/* Transitions */
.window-enter-active,
.window-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.window-enter-from,
.window-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* Small screens: the window nearly fills the width */
@media (max-width: 480px) {
  .root {
    right: 12px;
    bottom: 12px;
  }

  .window {
    width: calc(100vw - 24px);
    height: calc(100vh - 96px);
    height: calc(100dvh - 96px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .window-enter-active,
  .window-leave-active,
  .pop-enter-active,
  .pop-leave-active,
  .launcher {
    transition: none;
  }

  .typing i {
    animation: none;
    opacity: 0.6;
  }
}
</style>
