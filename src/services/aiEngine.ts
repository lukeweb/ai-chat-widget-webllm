import {
  CreateWebWorkerMLCEngine,
  type MLCEngineInterface,
  type ChatCompletionMessageParam,
  type ChatCompletionChunk,
} from "@mlc-ai/web-llm";
import { readonly, shallowRef } from "vue";
import { MAX_HISTORY_MESSAGES, MODEL_ID } from "@/config/appConfig";
import { SYSTEM_PROMPT } from "@/config/systemPrompt";
import EngineWorker from "./aiEngine.worker?worker&inline";
import { retrieve } from "./retriever";

let engine: MLCEngineInterface | null = null;
let initPromise: Promise<void> | null = null;
let worker: Worker | null = null;

let generating = false;
let abortRequested = false;
let initGeneration = 0;

export type ModelStatus =
  | { state: "idle" }
  | { state: "preparing"; progress: number }
  | { state: "initializing" }
  | { state: "ready" }
  | { state: "error"; message: string }
  | { state: "cancelled" };

const mutableModelStatus = shallowRef<ModelStatus>({ state: "idle" });
export const modelStatus = readonly(mutableModelStatus);

const history: ChatCompletionMessageParam[] = [];

export const isWebGpuAvailable = async (): Promise<boolean> => {
  if (typeof window === "undefined" || !navigator.gpu) return false;

  try {
    return (await navigator.gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const initializeModel = async (): Promise<void> => {
  if (mutableModelStatus.value.state === "ready") return;
  if (initPromise) return initPromise;

  const generation = initGeneration;
  mutableModelStatus.value = { state: "initializing" };

  try {
    if (!(await isWebGpuAvailable())) {
      throw new Error("WebGPU is unavailable or no compatible adapter was found.");
    }
    if (generation !== initGeneration) {
      return;
    }

    await initEngine((progress, text) => {
      if (text.startsWith("Fetching param cache")) {
        mutableModelStatus.value = { state: "preparing", progress };
      } else {
        // Other progress values describe cache loading or GPU setup, not total download progress.
        mutableModelStatus.value = { state: "initializing" };
      }
    });

    mutableModelStatus.value = { state: "ready" };
  } catch (error) {
    if (generation !== initGeneration) {
      throw error;
    }

    mutableModelStatus.value = { state: "error", message: errorMessage(error) };
    console.error("[ai-widget] model initialization failed", error);
    throw error;
  }
};

export const initEngine = async (onProgress: (p: number, text: string) => void): Promise<void> => {
  if (!initPromise) {
    const generation = initGeneration;
    const newWorker = new EngineWorker();

    initPromise = CreateWebWorkerMLCEngine(newWorker, MODEL_ID, {
      initProgressCallback: (r) => onProgress(r.progress, r.text),
    })
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

export const sendMessage = async (
  userMessage: string,
  onToken: (t: string) => void,
  context: string = ""
): Promise<{ text: string; truncated: boolean; aborted?: boolean }> => {
  const currentEngine = engine;
  if (!currentEngine) throw new Error("Engine not initialized");
  if (generating) throw new Error("Generation already in progress");
  const generation = initGeneration;
  generating = true;
  abortRequested = false;

  let fullResponse = "";
  let finishReason: string | null = null;

  try {
    const extContext = await retrieve(userMessage);
    if (abortRequested || generation !== initGeneration || engine !== currentEngine) {
      return { text: fullResponse, truncated: false, aborted: true };
    }

    const messageContext = context === "" ? extContext : `${context}\n${extContext}`;
    const stream: AsyncIterable<ChatCompletionChunk> = await currentEngine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: `Context:\n${messageContext}\nQuestion:\n${userMessage}` },
      ],
      stream: true,
      temperature: 0.2,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const content = choice?.delta?.content;

      if (content) {
        fullResponse += content;
        if (generation === initGeneration && engine === currentEngine) onToken(content);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    if (fullResponse && generation === initGeneration && engine === currentEngine) {
      history.push({ role: "user", content: userMessage });
      history.push({ role: "assistant", content: fullResponse });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));
    }

    return {
      text: fullResponse,
      truncated: finishReason === "length",
      ...(abortRequested ? { aborted: true } : {}),
    };
  } catch (error) {
    if (abortRequested || generation !== initGeneration || engine !== currentEngine) {
      return { text: fullResponse, truncated: false, aborted: true };
    }
    throw error;
  } finally {
    generating = false;
    abortRequested = false;
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

export const disposeEngine = async (): Promise<void> => {
  const currentEngine = engine;
  const currentWorker = worker;
  engine = null;
  worker = null;
  initPromise = null;
  initGeneration++;
  history.length = 0;

  mutableModelStatus.value = { state: "cancelled" };

  try {
    if (generating) currentEngine?.interruptGenerate();
    await currentEngine?.unload();
  } finally {
    currentWorker?.terminate();
  }
};
