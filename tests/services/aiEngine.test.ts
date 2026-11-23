import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/services/retriever", () => ({
  retrieve: jest.fn(),
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
};
type CreateCompletion = (request: CompletionRequest) => Promise<AsyncIterable<Chunk>>;
type EngineCreator = (
  worker: Worker,
  modelId: string,
  options: {
    initProgressCallback: (progress: { progress: number; text: string; timeElapsed?: number }) => void;
  }
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
      expect(api.modelStatus.value).toEqual({ state: "error", message: "download failed" });

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
      });
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
});
