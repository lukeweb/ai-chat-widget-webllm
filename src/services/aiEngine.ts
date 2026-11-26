import type {
  MLCEngineInterface,
  ChatCompletionMessageParam,
  ChatCompletionChunk,
} from "@mlc-ai/web-llm";
import { readonly, shallowRef } from "vue";
import {
  LITE_CONTEXT_WINDOW,
  LITE_MODEL_ID,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_INPUT_CHARS,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
} from "@/config/appConfig";
import { contentReady, getContent } from "@/services/content";
import {
  buildLiteExampleMessages,
  buildLiteSystemPrompt,
  buildLiteUserMessage,
  buildNoInformationReply,
  buildSystemPrompt,
  buildUserMessage,
  extractLiteAnswer,
} from "@/services/prompt";
import { classifyInitError, type InitErrorReason } from "@/services/initError";
import { findUnsupportedNumbers } from "@/services/factGuard";
import {
  readDeviceSignals,
  selectModelTier,
  type ModelTier,
  type ModelTierPreference,
} from "@/services/modelTier";
import EngineWorker from "./aiEngine.worker?worker";
import { formatContext, retrieve, retrieveEntries } from "./retriever";

let engine: MLCEngineInterface | null = null;
let initPromise: Promise<void> | null = null;
let worker: Worker | null = null;

let generating = false;
let settleWaiters: Array<() => void> = [];
const mutableIsGenerating = shallowRef(false);
export const isGenerating = readonly(mutableIsGenerating);
let abortRequested = false;
let initGeneration = 0;

export type ModelStatus =
  | { state: "idle" }
  | { state: "preparing"; progress: number }
  | { state: "initializing" }
  | { state: "ready" }
  | { state: "error"; message: string; reason: InitErrorReason }
  | { state: "cancelled" };

const mutableModelStatus = shallowRef<ModelStatus>({ state: "idle" });
export const modelStatus = readonly(mutableModelStatus);

const history: ChatCompletionMessageParam[] = [];

// The tier is chosen once, when the page-wide engine first initializes, and kept until disposal.
let activeTier: ModelTier | null = null;
const mutableModelTier = shallowRef<ModelTier | null>(null);
export const modelTier = readonly(mutableModelTier);

// Lite profile: a smaller task for the smaller model (fewer entries, shorter context and reply).
const LITE_MAX_DOCUMENTS = 2;
// A second entry is sent only when it scores close to the best one.
const LITE_SECOND_ENTRY_RATIO = 0.9;
const LITE_MAX_CONTEXT_CHARS = 1000;
const LITE_MAX_OUTPUT_TOKENS = 200;
const LITE_HISTORY_MESSAGES = 4;

export interface SendResult {
  text: string;
  truncated: boolean;
  aborted?: boolean;
  /** Set when the lite model's answer contained unsupported numbers and was replaced. */
  factChecked?: "replaced";
}

export class InputTooLongError extends Error {
  constructor(readonly maxChars: number) {
    super(`Message is longer than ${maxChars} characters`);
    this.name = "InputTooLongError";
  }
}

export class ContextOverflowError extends Error {
  constructor(options?: ErrorOptions) {
    super("The conversation no longer fits into the model's context window", options);
    this.name = "ContextOverflowError";
  }
}

const isContextOverflow = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "ContextWindowSizeExceededError" || /context window size/i.test(error.message));

export const isWebGpuAvailable = async (): Promise<boolean> => {
  if (typeof window === "undefined" || !navigator.gpu) return false;

  try {
    return (await navigator.gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
};

const INITIALIZATION_CANCELLED_MESSAGE = "Model initialization was cancelled";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Asks the browser to keep the model cache instead of evicting it under storage pressure.
 * Best effort: unsupported or refused requests never block initialization.
 */
export const requestPersistentStorage = async (): Promise<void> => {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Persistence is optional; the download still works with best-effort storage.
  }
};

/** Collects storage usage for the failure log, so a quota problem can be confirmed on a device. */
const describeStorage = async (): Promise<string> => {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return "storage estimate unavailable";
    const mb = (bytes?: number) => (bytes === undefined ? "?" : Math.round(bytes / 1048576));
    return `storage usage ${mb(estimate.usage)} MB of ${mb(estimate.quota)} MB quota`;
  } catch {
    return "storage estimate unavailable";
  }
};

/**
 * Returns the tier the engine uses, or would use for `preference` if it has not started yet.
 * Lets the UI show the right download size before the chat is opened.
 */
export const previewModelTier = async (
  preference: ModelTierPreference = "auto"
): Promise<ModelTier> => activeTier ?? selectModelTier(preference, await readDeviceSignals());

export interface InitializeOptions {
  /** Host preference from the `model-tier` attribute. Ignored once the tier has been chosen. */
  tier?: ModelTierPreference;
}

export const initializeModel = async (options: InitializeOptions = {}): Promise<void> => {
  if (mutableModelStatus.value.state === "ready") return;
  if (initPromise) return initPromise;

  const generation = initGeneration;
  mutableModelStatus.value = { state: "initializing" };

  try {
    if (!(await isWebGpuAvailable())) {
      throw new Error("WebGPU is unavailable or no compatible adapter was found.");
    }
    const tier = await previewModelTier(options.tier);
    if (generation !== initGeneration) {
      throw new Error(INITIALIZATION_CANCELLED_MESSAGE);
    }
    // The first call to commit a tier wins, so overlapping first calls share one engine and the
    // reported tier always matches the model that is loaded.
    activeTier ??= tier;
    mutableModelTier.value = activeTier;

    // Not awaited: some browsers (e.g. Firefox) show a permission prompt that could otherwise
    // hold the download until the visitor answers it.
    void requestPersistentStorage();

    await initEngine((progress, text) => {
      if (text.startsWith("Fetching param cache")) {
        mutableModelStatus.value = { state: "preparing", progress };
      } else {
        // Other progress values describe cache loading or GPU setup, not total download progress.
        mutableModelStatus.value = { state: "initializing" };
      }
    }, activeTier);

    mutableModelStatus.value = { state: "ready" };
  } catch (error) {
    if (generation !== initGeneration) {
      throw error;
    }

    const reason = classifyInitError(error);
    mutableModelStatus.value = { state: "error", message: errorMessage(error), reason };
    console.error(
      `[ai-widget] model initialization failed (${reason}; ${await describeStorage()})`,
      error
    );
    throw error;
  }
};

export const initEngine = async (
  onProgress: (p: number, text: string) => void,
  tier: ModelTier = "full"
): Promise<void> => {
  if (!initPromise) {
    const generation = initGeneration;
    const newWorker = new EngineWorker();
    const engineConfig = {
      initProgressCallback: (r: { progress: number; text: string }) => {
        // A disposed engine must not overwrite the cancelled status with late progress events.
        if (generation === initGeneration) onProgress(r.progress, r.text);
      },
    };

    // WebLLM is loaded on demand so that it stays out of the entry bundle.
    initPromise = import("@mlc-ai/web-llm")
      .then(({ CreateWebWorkerMLCEngine }) =>
        tier === "lite"
          ? // A smaller context window needs less GPU memory on phones.
            CreateWebWorkerMLCEngine(newWorker, LITE_MODEL_ID, engineConfig, {
              context_window_size: LITE_CONTEXT_WINDOW,
            })
          : CreateWebWorkerMLCEngine(newWorker, MODEL_ID, engineConfig)
      )
      .then(async (created) => {
        if (generation !== initGeneration) {
          await created.unload();
          throw new Error("Engine was disposed during initialization");
        }
        engine = created;
        worker = newWorker;
      })
      .catch((error) => {
        newWorker.terminate();
        if (generation === initGeneration) initPromise = null;

        throw error;
      });
  }

  return initPromise;
};

const recordExchange = (userMessage: string, assistantMessage: string): void => {
  if (!assistantMessage) return;
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: assistantMessage });
  trimHistory();
};

const historyChars = (): number =>
  history.reduce((total, message) => total + String(message.content ?? "").length, 0);

// Drops the oldest user/assistant pairs until both the message-count and the character budget hold.
const trimHistory = (): void => {
  while (
    history.length >= 2 &&
    (history.length > MAX_HISTORY_MESSAGES || historyChars() > MAX_HISTORY_CHARS)
  ) {
    history.splice(0, 2);
  }
};

const previousUserMessage = (): string | undefined => {
  const previous = [...history].reverse().find((message) => message.role === "user");
  return typeof previous?.content === "string" ? previous.content : undefined;
};

interface PreparedRequest {
  messages: ChatCompletionMessageParam[];
  temperature: number;
  maxTokens: number;
  extraBody?: { enable_thinking: boolean };
  /** Lite only: the reply is buffered and checked against `context` before it is shown. */
  check?: { context: string; fallback: string };
}

const prepareFullRequest = async (userMessage: string): Promise<PreparedRequest> => {
  const context = await retrieve(userMessage, previousUserMessage());
  return {
    messages: [
      { role: "system", content: buildSystemPrompt(getContent()) },
      ...history,
      { role: "user", content: buildUserMessage(context, userMessage) },
    ],
    temperature: 0.1,
    maxTokens: MAX_OUTPUT_TOKENS,
  };
};

const prepareLiteRequest = (userMessage: string): PreparedRequest => {
  const content = getContent();
  const { language, results } = retrieveEntries(
    userMessage,
    previousUserMessage(),
    content.knowledgeBase,
    { maxDocuments: LITE_MAX_DOCUMENTS, minSecondScoreRatio: LITE_SECOND_ENTRY_RATIO }
  );
  const context = formatContext(results, LITE_MAX_CONTEXT_CHARS);
  const best = results[0]?.document;
  return {
    messages: [
      { role: "system", content: buildLiteSystemPrompt(content, language) },
      ...buildLiteExampleMessages(language),
      ...history.slice(-LITE_HISTORY_MESSAGES),
      { role: "user", content: buildLiteUserMessage(context, userMessage, language) },
    ],
    temperature: 0,
    maxTokens: Math.min(LITE_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    // Qwen3-family models would otherwise spend the token budget on hidden reasoning.
    extraBody: { enable_thinking: false },
    check: {
      context,
      // If the answer is rejected, the matching entry itself is the safest reply.
      fallback: best
        ? `${best.title}: ${best.content}`
        : buildNoInformationReply(content, language),
    },
  };
};

export const sendMessage = async (
  userMessage: string,
  onToken: (t: string) => void
): Promise<SendResult> => {
  const currentEngine = engine;
  if (!currentEngine) throw new Error("Engine not initialized");
  if (generating) throw new Error("Generation already in progress");
  if (userMessage.length > MAX_INPUT_CHARS) throw new InputTooLongError(MAX_INPUT_CHARS);
  const generation = initGeneration;
  generating = true;
  mutableIsGenerating.value = true;
  abortRequested = false;

  let fullResponse = "";
  let finishReason: string | null = null;
  // The lite reply is shown only after the number check, so it is not streamed token by token.
  const buffered = activeTier === "lite";
  const isCurrent = () => generation === initGeneration && engine === currentEngine;

  try {
    await contentReady();
    const request =
      activeTier === "lite"
        ? prepareLiteRequest(userMessage)
        : await prepareFullRequest(userMessage);
    if (abortRequested || !isCurrent()) {
      return { text: fullResponse, truncated: false, aborted: true };
    }

    const stream: AsyncIterable<ChatCompletionChunk> = await currentEngine.chat.completions.create({
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.extraBody ? { extra_body: request.extraBody } : {}),
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const content = choice?.delta?.content;

      if (content) {
        fullResponse += content;
        if (!buffered && isCurrent()) onToken(content);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    if (buffered) {
      // Nothing was shown yet, so an aborted lite reply leaves no trace.
      if (abortRequested || !isCurrent()) return { text: "", truncated: false, aborted: true };

      // Small models may repeat the prompt or show reasoning; keep only the answer itself.
      const answer = extractLiteAnswer(fullResponse);
      const check = request.check;
      const rejected =
        check !== undefined &&
        fullResponse.trim() !== "" &&
        (answer === null || findUnsupportedNumbers(answer, check.context, userMessage).length > 0);
      const text = rejected && check ? check.fallback : (answer ?? "");

      if (text) onToken(text);
      recordExchange(userMessage, text);
      return {
        text,
        truncated: !rejected && finishReason === "length",
        ...(rejected ? { factChecked: "replaced" as const } : {}),
      };
    }

    if (isCurrent()) recordExchange(userMessage, fullResponse);

    return {
      text: fullResponse,
      truncated: finishReason === "length",
      ...(abortRequested ? { aborted: true } : {}),
    };
  } catch (error) {
    if (abortRequested || !isCurrent()) {
      // Keep the partial reply the user saw so the model sees it in later turns. A buffered
      // (lite) reply was never shown, so there is nothing to keep.
      if (buffered) return { text: "", truncated: false, aborted: true };
      if (abortRequested && isCurrent()) recordExchange(userMessage, fullResponse);
      return { text: fullResponse, truncated: false, aborted: true };
    }
    if (isContextOverflow(error)) throw new ContextOverflowError({ cause: error });
    throw error;
  } finally {
    generating = false;
    mutableIsGenerating.value = false;
    abortRequested = false;
    const waiters = settleWaiters;
    settleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
};

export const abort = (): void => {
  if (!generating) return;
  abortRequested = true;
  engine?.interruptGenerate();
};

export const resetConversation = (): void => {
  if (generating) throw new Error("Cannot reset while generating");
  history.length = 0;
};

/** Aborts any generation, waits for it to settle, then clears the conversation history. */
export const startNewChat = async (): Promise<void> => {
  if (generating) {
    const settled = new Promise<void>((resolve) => settleWaiters.push(resolve));
    abort();
    await settled;
  }
  history.length = 0;
};

export const disposeEngine = async (): Promise<void> => {
  const currentEngine = engine;
  const currentWorker = worker;
  engine = null;
  worker = null;
  initPromise = null;
  initGeneration++;
  history.length = 0;
  // After an explicit destroy, the next start may choose the tier again.
  activeTier = null;
  mutableModelTier.value = null;

  mutableModelStatus.value = { state: "cancelled" };

  try {
    if (generating) currentEngine?.interruptGenerate();
    await currentEngine?.unload();
  } catch (error) {
    // Disposal is usually fire-and-forget, so report the failure here instead of rejecting.
    console.error("[ai-widget] engine unload failed", error);
  } finally {
    currentWorker?.terminate();
  }
};

/** Public lifecycle API: idempotent start and explicit destroy of the page-wide engine. */
export const startEngine = initializeModel;
export const destroyEngine = disposeEngine;
