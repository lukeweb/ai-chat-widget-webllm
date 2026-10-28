import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";
import { SYSTEM_PROMPT } from "../../src/config/systemPrompt";

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
};
type CreateCompletion = (request: CompletionRequest) => Promise<AsyncIterable<Chunk>>;
type EngineCreator = (
  worker: Worker,
  modelId: string,
  options: { initProgressCallback: (progress: { progress: number; text: string }) => void }
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
  let MockWorker: typeof import("../mocks/workerMock").default;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    const webLlmMock = jest.requireMock("@mlc-ai/web-llm") as {
      CreateWebWorkerMLCEngine: jest.Mock<EngineCreator>;
    };
    createEngine = webLlmMock.CreateWebWorkerMLCEngine;
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

  const initialize = async (engine = makeEngine()) => {
    createEngine.mockResolvedValue(engine);
    await api.initEngine(jest.fn());
    return engine;
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

      await expect(api.sendMessage("Hi", onToken, "extra context")).resolves.toEqual({
        text: "Hello there",
        truncated: true,
      });
      expect(onToken.mock.calls).toEqual([["Hello"], [" there"]]);
      expect(engine.chat.completions.create.mock.calls[0]![0].messages).toEqual([
        { role: "system", content: `${SYSTEM_PROMPT}\n\nextra context` },
        { role: "user", content: "Hi" },
      ]);

      engine.chat.completions.create.mockResolvedValue(
        stream({ choices: [{ delta: { content: "Next" }, finish_reason: "stop" }] })
      );
      await api.sendMessage("Follow up", jest.fn());
      expect(engine.chat.completions.create.mock.calls[1]![0].messages).toEqual([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there" },
        { role: "user", content: "Follow up" },
      ]);
    });

    it("rejects sends before initialization and while another generation is active", async () => {
      await expect(api.sendMessage("Hi", jest.fn())).rejects.toThrow("Engine not initialized");
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
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "after reset" },
      ]);
    });

    it("unloads and terminates resources on disposal", async () => {
      const engine = await initialize();
      const worker = MockWorker.instances[0];

      await api.disposeEngine();

      expect(engine.unload).toHaveBeenCalledTimes(1);
      expect(worker?.terminated).toBe(true);
      expect(api.abort).not.toThrow();
    });
  });
});
