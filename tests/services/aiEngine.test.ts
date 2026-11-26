import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/services/retriever", () => ({
  retrieve: jest.fn(),
  retrieveEntries: jest.fn(),
  formatContext: jest.requireActual<typeof import("../../src/services/retriever")>(
    "../../src/services/retriever"
  ).formatContext,
}));

jest.mock("@mlc-ai/web-llm", () => ({
  CreateWebWorkerMLCEngine: jest.fn(),
}));

type EngineStub = {
  chat: { completions: { create: jest.Mock<CreateCompletion> } };
  interruptGenerate: jest.Mock<() => void>;
  unload: jest.Mock<() => Promise<void>>;
};

type Chunk = {
  choices: Array<{ delta?: { content?: string }; finish_reason?: string }>;
};
type CompletionRequest = {
  messages: Array<{ role: string; content: string }>;
  stream: true;
  temperature: number;
  max_tokens: number;
  extra_body?: { enable_thinking: boolean };
};
type CreateCompletion = (request: CompletionRequest) => Promise<AsyncIterable<Chunk>>;
type EngineCreator = (
  worker: Worker,
  modelId: string,
  options: {
    initProgressCallback: (progress: { progress: number; text: string; timeElapsed?: number }) => void;
  },
  chatOptions?: { context_window_size?: number }
) => Promise<EngineStub>;

const makeEngine = (): EngineStub => ({
  chat: {
    completions: {
      create: jest.fn<CreateCompletion>(),
    },
  },
  interruptGenerate: jest.fn<() => void>(),
  unload: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
});

const stream = async function* (...chunks: Chunk[]): AsyncGenerator<Chunk> {
  for (const chunk of chunks) yield chunk;
};

describe("aiEngine", () => {
  let api: typeof import("../../src/services/aiEngine");
  let createEngine: jest.Mock<EngineCreator>;
  let retrieveMock: jest.Mock<(content: string, previousContent?: string) => Promise<string>>;
  let MockWorker: typeof import("../mocks/workerMock").default;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    const webLlmMock = jest.requireMock("@mlc-ai/web-llm") as {
      CreateWebWorkerMLCEngine: jest.Mock<EngineCreator>;
    };
    createEngine = webLlmMock.CreateWebWorkerMLCEngine;
    retrieveMock = (jest.requireMock("../../src/services/retriever") as {
      retrieve: jest.Mock<(content: string, previousContent?: string) => Promise<string>>;
    }).retrieve;
    retrieveMock.mockResolvedValue("retrieved context");
    MockWorker = jest.requireActual<typeof import("../mocks/workerMock")>(
      "../mocks/workerMock"
    ).default;
    MockWorker.instances.length = 0;
    api = jest.requireActual<typeof import("../../src/services/aiEngine")>(
      "../../src/services/aiEngine"
    );
  });

  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

  const initialize = async (engine = makeEngine()) => {
    createEngine.mockResolvedValue(engine);
    await api.initEngine(jest.fn());
    return engine;
  };

  const mockAvailableWebGpu = (
    requestAdapter: jest.Mock<() => Promise<unknown>> = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({})
  ) => {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: { requestAdapter } },
      configurable: true,
    });
    return requestAdapter;
  };

  describe("isWebGpuAvailable", () => {
    it("returns false when window is unavailable", async () => {
      expect(await api.isWebGpuAvailable()).toBe(false);
    });

    it("returns false when there is no GPU API", async () => {
      Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
      Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

      expect(await api.isWebGpuAvailable()).toBe(false);
    });

    it("returns whether an adapter is available and handles request failures", async () => {
      Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
      const requestAdapter = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
      Object.defineProperty(globalThis, "navigator", {
        value: { gpu: { requestAdapter } },
        configurable: true,
      });
      expect(await api.isWebGpuAvailable()).toBe(true);

      requestAdapter.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"));
      expect(await api.isWebGpuAvailable()).toBe(false);
      expect(await api.isWebGpuAvailable()).toBe(false);
    });
  });

  describe("initEngine", () => {
    it("shares initialization and reports progress through the first callback", async () => {
      const engine = makeEngine();
      createEngine.mockResolvedValue(engine);
      const firstProgress = jest.fn<(progress: number, text: string) => void>();
      const secondProgress = jest.fn<(progress: number, text: string) => void>();

      const first = api.initEngine(firstProgress);
      const second = api.initEngine(secondProgress);
      await Promise.all([first, second]);

      expect(createEngine).toHaveBeenCalledTimes(1);
      const options = createEngine.mock.calls[0]![2]!;
      options.initProgressCallback({ progress: 0.5, text: "loading" });
      expect(firstProgress).toHaveBeenCalledWith(0.5, "loading");
      expect(secondProgress).not.toHaveBeenCalled();
    });

    it("terminates a failed worker and allows initialization to retry", async () => {
      createEngine.mockRejectedValueOnce(new Error("load failed"));
      await expect(api.initEngine(jest.fn())).rejects.toThrow("load failed");
      expect(MockWorker.instances[0]?.terminated).toBe(true);

      const engine = makeEngine();
      createEngine.mockResolvedValueOnce(engine);
      await expect(api.initEngine(jest.fn())).resolves.toBeUndefined();
      expect(createEngine).toHaveBeenCalledTimes(2);
    });

    it("unloads an engine created after disposal during initialization", async () => {
      let resolveCreation!: (engine: EngineStub) => void;
      createEngine.mockReturnValue(
        new Promise<EngineStub>((resolve) => {
          resolveCreation = resolve;
        })
      );
      const initialization = api.initEngine(jest.fn());
      const worker = MockWorker.instances[0];

      await api.disposeEngine();
      const engine = makeEngine();
      resolveCreation(engine);

      await expect(initialization).rejects.toThrow("Engine was disposed during initialization");
      expect(engine.unload).toHaveBeenCalledTimes(1);
      expect(worker?.terminated).toBe(true);
    });
  });

  describe("requestPersistentStorage", () => {
    it("does not throw when navigator.storage is absent", async () => {
      Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

      await expect(api.requestPersistentStorage()).resolves.toBeUndefined();
    });
  });

  describe("model initialization status", () => {
    it("starts idle, reports preparation progress, then becomes ready", async () => {
      mockAvailableWebGpu();
      const engine = makeEngine();
      const observedStates: Array<{ state: string; progress?: number }> = [];
      createEngine.mockImplementation((_worker, _modelId, options) => {
        options.initProgressCallback({
          progress: 0.37,
          text: "Fetching param cache[2/4]: 37% completed",
          timeElapsed: 2,
        });
        observedStates.push(api.modelStatus.value);
        return Promise.resolve(engine);
      });

      expect(api.modelStatus.value).toEqual({ state: "idle" });
      await api.initializeModel();

      expect(observedStates).toEqual([{ state: "preparing", progress: 0.37 }]);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("treats cached model loading and shader progress as initialization, not download", async () => {
      mockAvailableWebGpu();
      const engine = makeEngine();
      const observedStates: Array<{ state: string; progress?: number }> = [];
      createEngine.mockImplementation((_worker, _modelId, options) => {
        options.initProgressCallback({ progress: 0.8, text: "Loading model from cache[3/4]" });
        observedStates.push(api.modelStatus.value);
        options.initProgressCallback({ progress: 0.5, text: "Loading GPU shader modules[4/8]" });
        observedStates.push(api.modelStatus.value);
        return Promise.resolve(engine);
      });

      await api.initializeModel();

      expect(observedStates).toEqual([{ state: "initializing" }, { state: "initializing" }]);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("retains initialization errors and allows a retry", async () => {
      mockAvailableWebGpu();
      createEngine.mockRejectedValueOnce(new Error("download failed"));

      await expect(api.initializeModel()).rejects.toThrow("download failed");
      expect(api.modelStatus.value).toEqual({
        state: "error",
        message: "download failed",
        reason: "unknown",
      });

      const engine = makeEngine();
      createEngine.mockResolvedValueOnce(engine);
      await api.initializeModel();

      expect(createEngine).toHaveBeenCalledTimes(2);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("reports WebGPU unavailability as an error without creating a worker", async () => {
      mockAvailableWebGpu(jest.fn<() => Promise<unknown>>().mockResolvedValue(null));

      await expect(api.initializeModel()).rejects.toThrow("WebGPU is unavailable");

      expect(createEngine).not.toHaveBeenCalled();
      expect(api.modelStatus.value).toEqual({
        state: "error",
        message: "WebGPU is unavailable or no compatible adapter was found.",
        reason: "webgpu-unavailable",
      });
    });

    it("classifies a storage quota failure forwarded by the worker as a string", async () => {
      mockAvailableWebGpu();
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      createEngine.mockRejectedValueOnce("QuotaExceededError: Quota exceeded.");

      await expect(api.initializeModel()).rejects.toBe("QuotaExceededError: Quota exceeded.");

      expect(api.modelStatus.value).toEqual({
        state: "error",
        message: "QuotaExceededError: Quota exceeded.",
        reason: "storage-quota",
      });
      expect(consoleError.mock.calls[0]![0]).toContain("storage-quota");
      consoleError.mockRestore();
    });

    it("logs storage usage with the failure when the browser reports it", async () => {
      mockAvailableWebGpu();
      const estimate = jest
        .fn<() => Promise<StorageEstimate>>()
        .mockResolvedValue({ usage: 600 * 1048576, quota: 640 * 1048576 });
      (navigator as unknown as { storage: Partial<StorageManager> }).storage = { estimate };
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      createEngine.mockRejectedValueOnce("TypeError: Failed to fetch");

      await expect(api.initializeModel()).rejects.toBe("TypeError: Failed to fetch");

      expect(consoleError.mock.calls[0]![0]).toContain("network");
      expect(consoleError.mock.calls[0]![0]).toContain("600 MB of 640 MB quota");
      consoleError.mockRestore();
    });

    it.each([
      ["no estimate API", {}, "storage estimate unavailable"],
      [
        "a rejected estimate",
        { estimate: () => Promise.reject(new Error("unavailable")) },
        "storage estimate unavailable",
      ],
      [
        "a partial estimate",
        { estimate: () => Promise.resolve({ usage: 1048576 }) },
        "storage usage 1 MB of ? MB quota",
      ],
      ["an empty estimate", { estimate: () => Promise.resolve({}) }, "storage usage ? MB of ? MB quota"],
    ] as const)("logs the failure safely with %s", async (_label, storage, expected) => {
      mockAvailableWebGpu();
      (navigator as unknown as { storage: Partial<StorageManager> }).storage = storage;
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      createEngine.mockRejectedValueOnce("TypeError: Failed to fetch");

      await expect(api.initializeModel()).rejects.toBe("TypeError: Failed to fetch");

      expect(consoleError.mock.calls[0]![0]).toContain(expected);
      consoleError.mockRestore();
    });

    it("requests persistent storage before downloading the model", async () => {
      mockAvailableWebGpu();
      const order: string[] = [];
      const persist = jest.fn<() => Promise<boolean>>().mockImplementation(async () => {
        order.push("persist");
        return true;
      });
      (navigator as unknown as { storage: Partial<StorageManager> }).storage = { persist };
      createEngine.mockImplementation(async () => {
        order.push("create");
        return makeEngine();
      });

      await api.initializeModel();

      expect(order).toEqual(["persist", "create"]);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("still initializes when persistent storage is unsupported or refused", async () => {
      mockAvailableWebGpu();
      createEngine.mockResolvedValue(makeEngine());
      await api.initializeModel();
      expect(api.modelStatus.value).toEqual({ state: "ready" });

      await api.disposeEngine();
      const persist = jest.fn<() => Promise<boolean>>().mockRejectedValue(new Error("denied"));
      (navigator as unknown as { storage: Partial<StorageManager> }).storage = { persist };
      await api.initializeModel();

      expect(persist).toHaveBeenCalledTimes(1);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("does not wait for a pending persistent storage request before downloading", async () => {
      mockAvailableWebGpu();
      // A permission prompt the visitor never answers
      const persist = jest
        .fn<() => Promise<boolean>>()
        .mockReturnValue(new Promise<boolean>(() => {}));
      (navigator as unknown as { storage: Partial<StorageManager> }).storage = { persist };
      createEngine.mockResolvedValue(makeEngine());

      await api.initializeModel();

      expect(persist).toHaveBeenCalledTimes(1);
      expect(api.modelStatus.value).toEqual({ state: "ready" });
    });

    it("shares concurrent initialization and marks disposal during load as cancelled", async () => {
      mockAvailableWebGpu();
      let resolveCreation!: (engine: EngineStub) => void;
      createEngine.mockReturnValue(
        new Promise<EngineStub>((resolve) => {
          resolveCreation = resolve;
        })
      );

      const first = api.initializeModel();
      const second = api.initializeModel();
      await flushAsync();
      expect(createEngine).toHaveBeenCalledTimes(1);

      const disposed = api.disposeEngine();
      const engine = makeEngine();
      resolveCreation(engine);

      await disposed;
      await expect(first).rejects.toThrow("Engine was disposed during initialization");
      await expect(second).rejects.toThrow("Engine was disposed during initialization");
      expect(engine.unload).toHaveBeenCalledTimes(1);
      expect(api.modelStatus.value).toEqual({ state: "cancelled" });
    });
  });

  describe("disposal during initialization", () => {
    it("does not replace cancelled status with a classified error from a late rejection", async () => {
      mockAvailableWebGpu();
      let rejectCreation!: (error: unknown) => void;
      createEngine.mockReturnValue(new Promise<EngineStub>((_resolve, reject) => {
        rejectCreation = reject;
      }));

      const initialization = api.initializeModel();
      await flushAsync();
      const disposed = api.disposeEngine();
      rejectCreation("QuotaExceededError: Quota exceeded");
      await disposed;

      await expect(initialization).rejects.toBe("QuotaExceededError: Quota exceeded");
      expect(api.modelStatus.value).toEqual({ state: "cancelled" });
    });

    it("rejects initializeModel instead of resolving when disposed before the engine starts", async () => {
      let resolveAdapter!: (adapter: unknown) => void;
      mockAvailableWebGpu(
        jest.fn<() => Promise<unknown>>().mockReturnValue(
          new Promise((resolve) => {
            resolveAdapter = resolve;
          })
        )
      );

      const init = api.initializeModel();
      const disposed = api.disposeEngine();
      resolveAdapter({});

      await disposed;
      await expect(init).rejects.toThrow("Model initialization was cancelled");
      expect(createEngine).not.toHaveBeenCalled();
      expect(api.modelStatus.value).toEqual({ state: "cancelled" });
    });

    it("ignores progress events that arrive after disposal", async () => {
      mockAvailableWebGpu();
      let progress!: (report: { progress: number; text: string }) => void;
      let resolveCreation!: (engine: EngineStub) => void;
      createEngine.mockImplementation((_worker, _modelId, options) => {
        progress = options.initProgressCallback;
        return new Promise<EngineStub>((resolve) => {
          resolveCreation = resolve;
        });
      });

      const init = api.initializeModel();
      await flushAsync();
      await api.disposeEngine();
      progress({ progress: 0.5, text: "Fetching param cache" });
      progress({ progress: 0.9, text: "Loading GPU shader modules" });
      resolveCreation(makeEngine());

      await expect(init).rejects.toThrow();
      expect(api.modelStatus.value).toEqual({ state: "cancelled" });
    });
  });

  describe("sendMessage and conversation controls", () => {
    it("streams tokens, passes context, stores the exchange, and reports truncation", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        stream(
          { choices: [{ delta: { content: "Hello" } }] },
          { choices: [{ delta: { content: " there" }, finish_reason: "length" }] }
        )
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Hi", onToken)).resolves.toEqual({
        text: "Hello there",
        truncated: true,
      });
      expect(onToken.mock.calls).toEqual([["Hello"], [" there"]]);
      expect(retrieveMock).toHaveBeenCalledWith("Hi", undefined);
      expect(engine.chat.completions.create.mock.calls[0]![0].messages).toEqual([
        { role: "system", content: expect.stringContaining("virtual assistant of Bluebird Bike Workshop") },
        {
          role: "user",
          content: "KNOWLEDGE BASE:\nretrieved context\n\nQUESTION:\nHi",
        },
      ]);

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Next" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Follow up", jest.fn());
      expect(engine.chat.completions.create.mock.calls[1]![0].messages).toEqual([
        { role: "system", content: expect.stringContaining("virtual assistant of Bluebird Bike Workshop") },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there" },
        {
          role: "user",
          content: "KNOWLEDGE BASE:\nretrieved context\n\nQUESTION:\nFollow up",
        },
      ]);
    });

    it("rejects sends before initialization and while another generation is active", async () => {
      await expect(api.sendMessage("Hi", jest.fn())).rejects.toThrow("Engine not initialized");
      expect(retrieveMock).not.toHaveBeenCalled();
      const engine = await initialize();
      let release!: () => void;
      engine.chat.completions.create.mockResolvedValue(
        (async function* () {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] };
        })()
      );

      const firstSend = api.sendMessage("first", jest.fn<(token: string) => void>());
      await flushAsync();
      await expect(api.sendMessage("second", jest.fn())).rejects.toThrow(
        "Generation already in progress"
      );
      expect(() => api.resetConversation()).toThrow("Cannot reset while generating");
      api.abort();
      expect(engine.interruptGenerate).toHaveBeenCalledTimes(1);
      release();
      await firstSend;
    });

    it("does not add empty responses to history and reset clears previous exchanges", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValueOnce(stream({ choices: [{}] }));
      await api.sendMessage("empty", jest.fn());

      engine.chat.completions.create.mockResolvedValueOnce(
        stream({ choices: [{ delta: { content: "answer" } }] })
      );
      await api.sendMessage("question", jest.fn());
      await api.resetConversation();

      engine.chat.completions.create.mockResolvedValueOnce(stream({ choices: [{}] }));
      await api.sendMessage("after reset", jest.fn());
      expect(engine.chat.completions.create.mock.calls[2]![0].messages).toEqual([
        { role: "system", content: expect.stringContaining("virtual assistant of Bluebird Bike Workshop") },
        {
          role: "user",
          content: "KNOWLEDGE BASE:\nretrieved context\n\nQUESTION:\nafter reset",
        },
      ]);
    });

    it("releases the generation lock when retrieval fails and does not call the model", async () => {
      const engine = await initialize();
      retrieveMock.mockRejectedValueOnce(new Error("retrieval failed"));

      await expect(api.sendMessage("Question", jest.fn())).rejects.toThrow("retrieval failed");
      expect(engine.chat.completions.create).not.toHaveBeenCalled();

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Answer" }, finish_reason: "stop" }] })
      );
      await expect(api.sendMessage("Retry", jest.fn())).resolves.toMatchObject({ text: "Answer" });
    });

    it("skips model generation when aborted during retrieval", async () => {
      const engine = await initialize();
      let resolveRetrieval!: (context: string) => void;
      retrieveMock.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveRetrieval = resolve;
        })
      );

      const pendingSend = api.sendMessage("Question", jest.fn());
      api.abort();
      resolveRetrieval("retrieved context");

      await expect(pendingSend).resolves.toEqual({
        text: "",
        truncated: false,
        aborted: true,
      });
      expect(engine.chat.completions.create).not.toHaveBeenCalled();
    });

    it("does not start model generation if disposed during retrieval", async () => {
      const engine = await initialize();
      let resolveRetrieval!: (context: string) => void;
      retrieveMock.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveRetrieval = resolve;
        })
      );

      const pendingSend = api.sendMessage("Question", jest.fn());
      await api.disposeEngine();
      resolveRetrieval("retrieved context");

      await expect(pendingSend).resolves.toMatchObject({ aborted: true });
      expect(engine.chat.completions.create).not.toHaveBeenCalled();
    });

    it("exposes isGenerating reactively for the duration of a send", async () => {
      const engine = await initialize();
      let release!: () => void;
      engine.chat.completions.create.mockResolvedValue(
        (async function* () {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] };
        })()
      );
      expect(api.isGenerating.value).toBe(false);

      const send = api.sendMessage("question", jest.fn());
      await flushAsync();
      expect(api.isGenerating.value).toBe(true);

      release();
      await send;
      expect(api.isGenerating.value).toBe(false);
    });

    it("startNewChat aborts a running generation, waits for it to settle and clears history", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "First" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("kept?", jest.fn());

      let release!: () => void;
      engine.chat.completions.create.mockResolvedValue(
        (async function* (): AsyncGenerator<Chunk> {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield { choices: [{ delta: { content: "late" } }] };
        })()
      );
      const running = api.sendMessage("second", jest.fn());
      await flushAsync();

      let finished = false;
      const newChat = api.startNewChat().then(() => {
        finished = true;
      });
      await flushAsync();
      expect(engine.interruptGenerate).toHaveBeenCalled();
      expect(finished).toBe(false);

      release();
      await running;
      await newChat;
      expect(finished).toBe(true);
      expect(api.isGenerating.value).toBe(false);

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Fresh" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("after reset", jest.fn());
      const messages = engine.chat.completions.create.mock.calls.at(-1)![0].messages;
      expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    });

    it("startNewChat clears history immediately when nothing is generating", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "A" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("one", jest.fn());

      await api.startNewChat();
      await api.sendMessage("two", jest.fn());

      const messages = engine.chat.completions.create.mock.calls.at(-1)![0].messages;
      expect(messages).toHaveLength(2);
    });

    it("exposes startEngine and destroyEngine as the lifecycle API", () => {
      expect(api.startEngine).toBe(api.initializeModel);
      expect(api.destroyEngine).toBe(api.disposeEngine);
    });

    it("limits the reply length with max_tokens", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })
      );

      await api.sendMessage("Hi", jest.fn());

      expect(engine.chat.completions.create.mock.calls[0]![0].max_tokens).toBe(512);
    });

    it("rejects over-long input with InputTooLongError before retrieval or generation", async () => {
      const engine = await initialize();

      const send = api.sendMessage("x".repeat(1001), jest.fn());

      await expect(send).rejects.toBeInstanceOf(api.InputTooLongError);
      await expect(send).rejects.toMatchObject({ name: "InputTooLongError", maxChars: 1000 });
      expect(retrieveMock).not.toHaveBeenCalled();
      expect(engine.chat.completions.create).not.toHaveBeenCalled();
      expect(api.isGenerating.value).toBe(false);
    });

    it("accepts input of exactly the maximum length", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })
      );

      await expect(api.sendMessage("x".repeat(1000), jest.fn())).resolves.toMatchObject({
        text: "ok",
      });
    });

    it("drops the oldest exchange when the history character budget is exceeded", async () => {
      const engine = await initialize();
      const reply = (text: string) =>
        stream({ choices: [{ delta: { content: text }, finish_reason: "stop" }] });
      engine.chat.completions.create.mockResolvedValueOnce(reply("a".repeat(4000)));
      await api.sendMessage("first", jest.fn());
      engine.chat.completions.create.mockResolvedValueOnce(reply("b".repeat(4000)));
      await api.sendMessage("second", jest.fn());
      engine.chat.completions.create.mockResolvedValueOnce(reply("done"));

      await api.sendMessage("third", jest.fn());

      const sent = engine.chat.completions.create.mock.calls[2]![0].messages;
      expect(sent.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
      expect(sent[1]!.content).toBe("second");
    });

    it("keeps history in whole user/assistant pairs when trimming by message count", async () => {
      const engine = await initialize();
      for (const text of ["one", "two", "three"]) {
        engine.chat.completions.create.mockResolvedValueOnce(
          stream({ choices: [{ delta: { content: `re-${text}` }, finish_reason: "stop" }] })
        );
        await api.sendMessage(text, jest.fn());
      }
      engine.chat.completions.create.mockResolvedValueOnce(
        stream({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })
      );

      await api.sendMessage("four", jest.fn());

      const sent = engine.chat.completions.create.mock.calls[3]![0].messages;
      expect(sent.slice(1, -1).map((message) => message.content)).toEqual([
        "two",
        "re-two",
        "three",
        "re-three",
      ]);
    });

    it("maps a context window overflow to ContextOverflowError", async () => {
      const engine = await initialize();
      const overflow = new Error("Prompt tokens exceed context window size");
      overflow.name = "ContextWindowSizeExceededError";
      engine.chat.completions.create.mockRejectedValue(overflow);

      const send = api.sendMessage("Hi", jest.fn());

      await expect(send).rejects.toBeInstanceOf(api.ContextOverflowError);
      await expect(send).rejects.toMatchObject({ name: "ContextOverflowError", cause: overflow });
      expect(api.isGenerating.value).toBe(false);
    });

    it("rethrows other generation errors unchanged", async () => {
      const engine = await initialize();
      const failure = new Error("GPU lost");
      engine.chat.completions.create.mockRejectedValue(failure);

      await expect(api.sendMessage("Hi", jest.fn())).rejects.toBe(failure);
    });

    it("unloads and terminates resources on disposal", async () => {
      const engine = await initialize();
      const worker = MockWorker.instances[0];

      await api.disposeEngine();

      expect(engine.unload).toHaveBeenCalledTimes(1);
      expect(worker?.terminated).toBe(true);
      expect(api.abort).not.toThrow();
    });

    it("resolves disposal and still terminates the worker when unload fails", async () => {
      const engine = await initialize();
      engine.unload.mockRejectedValue(new Error("unload failed"));
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const worker = MockWorker.instances[0];

      await expect(api.disposeEngine()).resolves.toBeUndefined();

      expect(worker?.terminated).toBe(true);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("passes the previous user message to retrieval for follow-up questions", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockImplementation(() =>
        Promise.resolve(stream({ choices: [{ delta: { content: "Answer" }, finish_reason: "stop" }] }))
      );

      await api.sendMessage("What are your hours?", jest.fn());
      await api.sendMessage("And on Sunday?", jest.fn());

      expect(retrieveMock).toHaveBeenNthCalledWith(2, "And on Sunday?", "What are your hours?");
    });

    it("stores a partial reply in history when the user aborts and the stream throws", async () => {
      const engine = await initialize();
      engine.chat.completions.create.mockResolvedValue(
        (async function* (): AsyncGenerator<Chunk> {
          yield { choices: [{ delta: { content: "Partial" } }] };
          api.abort();
          throw new Error("interrupted");
        })()
      );

      await expect(api.sendMessage("Question", jest.fn())).resolves.toMatchObject({
        text: "Partial",
        aborted: true,
      });

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Next" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Next question", jest.fn());
      expect(engine.chat.completions.create.mock.calls[1]![0].messages).toEqual([
        { role: "system", content: expect.stringContaining("virtual assistant of Bluebird Bike Workshop") },
        { role: "user", content: "Question" },
        { role: "assistant", content: "Partial" },
        { role: "user", content: expect.stringContaining("Next question") },
      ]);
    });
  });

  describe("lite tier", () => {
    type RetrievedEntries = import("../../src/services/retriever").RetrievedEntries;
    const priceEntry = {
      document: { title: "Cennik", content: "Przegląd: 49 USD.", keywords: [] },
      score: 5,
    };
    let retrieveEntriesMock: jest.Mock<(...args: unknown[]) => RetrievedEntries>;

    beforeEach(() => {
      retrieveEntriesMock = (jest.requireMock("../../src/services/retriever") as {
        retrieveEntries: jest.Mock<(...args: unknown[]) => RetrievedEntries>;
      }).retrieveEntries;
      retrieveEntriesMock.mockReset().mockReturnValue({ language: "pl", results: [priceEntry] });
    });

    const initializeLite = async (engine = makeEngine()) => {
      mockAvailableWebGpu();
      createEngine.mockResolvedValue(engine);
      await api.initializeModel({ tier: "lite" });
      return engine;
    };

    it("loads the lite model with a smaller context window", async () => {
      await initializeLite();

      expect(createEngine.mock.calls[0]![1]).toBe("test-lite-model");
      expect(createEngine.mock.calls[0]![3]).toEqual({ context_window_size: 2048 });
      expect(api.modelTier.value).toBe("lite");
    });

    it("loads the full model without chat options on a desktop", async () => {
      mockAvailableWebGpu();
      createEngine.mockResolvedValue(makeEngine());
      await api.initializeModel();

      expect(createEngine.mock.calls[0]![1]).toBe("test-model");
      expect(createEngine.mock.calls[0]).toHaveLength(3);
      expect(api.modelTier.value).toBe("full");
    });

    it("chooses the lite tier automatically on a mobile device", async () => {
      mockAvailableWebGpu();
      (navigator as unknown as { userAgent: string }).userAgent =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36";
      createEngine.mockResolvedValue(makeEngine());

      expect(await api.previewModelTier()).toBe("lite");
      await api.initializeModel();
      expect(createEngine.mock.calls[0]![1]).toBe("test-lite-model");
    });

    it("uses one tier for overlapping first starts with different preferences", async () => {
      mockAvailableWebGpu();
      createEngine.mockResolvedValue(makeEngine());

      const first = api.initializeModel({ tier: "lite" });
      const second = api.initializeModel({ tier: "full" });
      await Promise.all([first, second]);

      expect(createEngine).toHaveBeenCalledTimes(1);
      expect(createEngine.mock.calls[0]![1]).toBe("test-lite-model");
      expect(api.modelTier.value).toBe("lite");
    });

    it("keeps the first tier until the engine is destroyed", async () => {
      await initializeLite();
      await api.initializeModel({ tier: "full" });

      expect(createEngine).toHaveBeenCalledTimes(1);
      expect(api.modelTier.value).toBe("lite");
      expect(await api.previewModelTier("full")).toBe("lite");

      await api.disposeEngine();
      expect(api.modelTier.value).toBeNull();
      createEngine.mockResolvedValue(makeEngine());
      await api.initializeModel({ tier: "full" });
      expect(createEngine.mock.calls[1]![1]).toBe("test-model");
    });

    it("sends a narrow Polish request and shows the checked answer in one piece", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream(
          { choices: [{ delta: { content: "Przegląd kosztuje " } }] },
          { choices: [{ delta: { content: "49 USD." }, finish_reason: "stop" }] }
        )
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Ile kosztuje przegląd?", onToken)).resolves.toEqual({
        text: "Przegląd kosztuje 49 USD.",
        truncated: false,
      });

      expect(onToken.mock.calls).toEqual([["Przegląd kosztuje 49 USD."]]);
      expect(retrieveEntriesMock).toHaveBeenCalledWith(
        "Ile kosztuje przegląd?",
        undefined,
        expect.anything(),
        { maxDocuments: 2, minSecondScoreRatio: 0.9 }
      );
      const request = engine.chat.completions.create.mock.calls[0]![0];
      expect(request).toMatchObject({
        temperature: 0,
        max_tokens: 200,
        extra_body: { enable_thinking: false },
      });
      expect(request.messages).toEqual([
        { role: "system", content: expect.stringContaining("Odpowiadaj po polsku") },
        // The worked example comes as chat turns before the history and the question.
        { role: "user", content: expect.stringContaining("Do której jesteście otwarci w piątek?") },
        { role: "assistant", content: "W piątek jesteśmy otwarci do 16:00." },
        {
          role: "user",
          content:
            "BAZA WIEDZY (KNOWLEDGE BASE):\nCennik\nPrzegląd: 49 USD.\n\nPYTANIE (QUESTION):\nIle kosztuje przegląd?",
        },
      ]);
    });

    it("replaces an answer with an unsupported number by the entry, also in history", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        // The wrong price is split across chunks.
        stream(
          { choices: [{ delta: { content: "Przegląd kosztuje 5" } }] },
          { choices: [{ delta: { content: "9 USD." }, finish_reason: "stop" }] }
        )
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Ile kosztuje przegląd?", onToken)).resolves.toEqual({
        text: "Cennik: Przegląd: 49 USD.",
        truncated: false,
        factChecked: "replaced",
      });
      expect(onToken.mock.calls).toEqual([["Cennik: Przegląd: 49 USD."]]);

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Tak." }, finish_reason: "stop" }] })
      );
      await api.sendMessage("A części?", jest.fn());
      expect(engine.chat.completions.create.mock.calls[1]![0].messages.slice(3, 5)).toEqual([
        { role: "user", content: "Ile kosztuje przegląd?" },
        { role: "assistant", content: "Cennik: Przegląd: 49 USD." },
      ]);
    });

    it("answers with the contact details when a number is unsupported and nothing matched", async () => {
      retrieveEntriesMock.mockReturnValue({ language: "pl", results: [] });
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Kosztuje 30 zł." }, finish_reason: "stop" }] })
      );

      const result = await api.sendMessage("Ile kosztuje mycie?", jest.fn());

      expect(result.factChecked).toBe("replaced");
      expect(result.text).toMatch(/^Nie mam tej informacji\. Skontaktuj się z nami: /);
    });

    it("removes a reasoning block before checking and showing the answer", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({
          choices: [{ delta: { content: "<think>ok 77</think>\nTo 49 USD." }, finish_reason: "stop" }],
        })
      );

      await expect(api.sendMessage("Ile?", jest.fn())).resolves.toEqual({
        text: "To 49 USD.",
        truncated: false,
      });
    });

    it("shows only the answer when the reply repeats the prompt", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream(
          { choices: [{ delta: { content: "BAZA WIEDZY (KNOWLEDGE BASE):\nCennik\nPrzegląd: 49 USD.\n\n" } }] },
          { choices: [{ delta: { content: "PYTANIE (QUESTION):\nIle?\n\nODPOWIEDŹ: " } }] },
          { choices: [{ delta: { content: "Przegląd kosztuje 49 USD." }, finish_reason: "stop" }] }
        )
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Ile?", onToken)).resolves.toEqual({
        text: "Przegląd kosztuje 49 USD.",
        truncated: false,
      });
      expect(onToken.mock.calls).toEqual([["Przegląd kosztuje 49 USD."]]);
    });

    it("shows the entry when the reply only repeats the prompt and runs out of tokens", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({
          choices: [
            {
              delta: { content: "BAZA WIEDZY (KNOWLEDGE BASE):\nCennik\nPrzegląd: 49 USD.\n\nPYTANIE" },
              finish_reason: "length",
            },
          ],
        })
      );

      await expect(api.sendMessage("Ile?", jest.fn())).resolves.toEqual({
        text: "Cennik: Przegląd: 49 USD.",
        truncated: false,
        factChecked: "replaced",
      });
    });

    it("gives the no-information reply when the reply only repeats the prompt and nothing matched", async () => {
      retrieveEntriesMock.mockReturnValue({ language: "pl", results: [] });
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({
          choices: [
            {
              delta: { content: "BAZA WIEDZY (KNOWLEDGE BASE):\n(no relevant information found)\n\nPYTANIE (QUESTION):\nIle?" },
              finish_reason: "stop",
            },
          ],
        })
      );
      const onToken = jest.fn<(token: string) => void>();

      const result = await api.sendMessage("Ile?", onToken);

      expect(result.factChecked).toBe("replaced");
      expect(result.text).toMatch(/^Nie mam tej informacji\. Skontaktuj się z nami: /);
      expect(onToken.mock.calls).toEqual([[result.text]]);

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Dobrze." }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Dzięki", jest.fn());
      expect(engine.chat.completions.create.mock.calls[1]![0].messages.slice(3, 5)).toEqual([
        { role: "user", content: "Ile?" },
        { role: "assistant", content: result.text },
      ]);
    });

    it("reports truncation only for an answer that was kept", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Przegląd kosztuje" }, finish_reason: "length" }] })
      );

      await expect(api.sendMessage("Ile?", jest.fn())).resolves.toEqual({
        text: "Przegląd kosztuje",
        truncated: true,
      });
    });

    it("shows and stores nothing when the user aborts a lite reply", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        (async function* (): AsyncGenerator<Chunk> {
          yield { choices: [{ delta: { content: "Częściowa" } }] };
          api.abort();
          throw new Error("interrupted");
        })()
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Pytanie", onToken)).resolves.toEqual({
        text: "",
        truncated: false,
        aborted: true,
      });
      expect(onToken).not.toHaveBeenCalled();

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Dalej." }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Następne", jest.fn());
      // System prompt, the two example turns and the question: no history from the aborted reply.
      expect(engine.chat.completions.create.mock.calls[1]![0].messages).toHaveLength(4);
    });

    it("shows nothing when the lite stream ends after an abort without throwing", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        (async function* (): AsyncGenerator<Chunk> {
          yield { choices: [{ delta: { content: "Częściowa" } }] };
          api.abort();
        })()
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Pytanie", onToken)).resolves.toMatchObject({
        text: "",
        aborted: true,
      });
      expect(onToken).not.toHaveBeenCalled();
    });

    it("rethrows a lite generation error without showing anything", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        (async function* (): AsyncGenerator<Chunk> {
          yield { choices: [{ delta: { content: "Częściowa" } }] };
          throw new Error("gpu failure");
        })()
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Pytanie", onToken)).rejects.toThrow("gpu failure");
      expect(onToken).not.toHaveBeenCalled();
    });

    it("does not show or store an empty lite answer", async () => {
      const engine = await initializeLite();
      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: {}, finish_reason: "stop" }] })
      );
      const onToken = jest.fn<(token: string) => void>();

      await expect(api.sendMessage("Pytanie", onToken)).resolves.toEqual({ text: "", truncated: false });
      expect(onToken).not.toHaveBeenCalled();
    });

    it("sends only the last two exchanges of history to the lite model", async () => {
      const engine = await initializeLite();
      for (const [index, answer] of ["A1.", "A2.", "A3."].entries()) {
        engine.chat.completions.create.mockResolvedValueOnce(
          stream({ choices: [{ delta: { content: answer }, finish_reason: "stop" }] })
        );
        await api.sendMessage(`Q${index + 1}`, jest.fn());
      }
      engine.chat.completions.create.mockResolvedValueOnce(
        stream({ choices: [{ delta: { content: "A4." }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Q4", jest.fn());

      const messages = engine.chat.completions.create.mock.calls[3]![0].messages;
      expect(messages.slice(3, -1)).toEqual([
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2." },
        { role: "user", content: "Q3" },
        { role: "assistant", content: "A3." },
      ]);
    });
  });
});
