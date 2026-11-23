import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL } from "../../src/config/knowledgeBase";
import {
  contentReady,
  DEFAULT_CONTENT,
  getContent,
  loadContent,
  MAX_CONTENT_SIZE,
} from "../../src/services/content";

const entry = (title = "T", content = "C", keywords: unknown = ["k"]) => ({
  title,
  content,
  keywords,
});
const validBody = (overrides: Record<string, unknown> = {}) => ({
  systemPrompt: "Prompt {{contact}}",
  contact: "Call 123",
  knowledgeBase: { en: [entry("Tyres", "We sell tyres.", ["tyres"])] },
  ...overrides,
});

const okResponse = (text: string) => ({ ok: true, status: 200, text: async () => text });
const respondWith = (body: unknown) => okResponse(JSON.stringify(body));

const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock<(url: string) => Promise<unknown>>;
let warnSpy: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
  fetchMock = jest.fn<(url: string) => Promise<unknown>>();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  await loadContent(undefined);
  globalThis.fetch = originalFetch;
  warnSpy.mockRestore();
});

describe("getContent defaults", () => {
  it("exposes the default prompt and contact", () => {
    expect(getContent().systemPrompt).toBe(DEFAULT_CONTENT.systemPrompt);
    expect(getContent().contact).toBe("Phone: +1 555 0100. Email: hello@bluebird-bikes.example.");
  });

  it("appends a generated contact entry derived from contact for en and pl", () => {
    const { en, pl } = getContent().knowledgeBase;

    expect(en).toHaveLength(KNOWLEDGE_BASE.length + 1);
    expect(en.at(-1)).toEqual({
      title: "Contact",
      content: DEFAULT_CONTENT.contact,
      keywords: ["contact", "phone", "telephone", "number", "email", "mail", "reach", "call"],
    });
    expect(pl).toHaveLength(KNOWLEDGE_BASE_PL.length + 1);
    expect(pl?.at(-1)).toEqual({
      title: "Kontakt",
      content: DEFAULT_CONTENT.contact,
      keywords: ["kontakt", "telefon", "numer", "email", "e-mail", "adres mailowy"],
    });
  });

  it("does not mutate the built-in knowledge base", () => {
    getContent();

    expect(DEFAULT_CONTENT.knowledgeBase.en).toBe(KNOWLEDGE_BASE);
    expect(KNOWLEDGE_BASE.some((item) => item.title === "Contact")).toBe(false);
  });
});

describe("loadContent", () => {
  it("replaces the content with a valid file and generates contact entries from it", async () => {
    fetchMock.mockResolvedValue(
      respondWith(
        validBody({
          knowledgeBase: {
            en: [entry("Tyres", "We sell tyres.", ["tyres"])],
            pl: [entry("Opony", "Sprzedajemy opony.", ["opony"])],
          },
        })
      )
    );

    await loadContent("/content.json");

    expect(fetchMock).toHaveBeenCalledWith("/content.json");
    expect(getContent()).toEqual({
      systemPrompt: "Prompt {{contact}}",
      contact: "Call 123",
      knowledgeBase: {
        en: [
          { title: "Tyres", content: "We sell tyres.", keywords: ["tyres"] },
          { title: "Contact", content: "Call 123", keywords: expect.arrayContaining(["phone"]) },
        ],
        pl: [
          { title: "Opony", content: "Sprzedajemy opony.", keywords: ["opony"] },
          { title: "Kontakt", content: "Call 123", keywords: expect.arrayContaining(["telefon"]) },
        ],
      },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("omits the Polish knowledge base when the file has none", async () => {
    fetchMock.mockResolvedValue(respondWith(validBody()));

    await loadContent("/content.json");

    expect(getContent().knowledgeBase.pl).toBeUndefined();
  });

  it("accepts an entry with an empty keywords array", async () => {
    fetchMock.mockResolvedValue(
      respondWith(validBody({ knowledgeBase: { en: [entry("T", "C", [])] } }))
    );

    await loadContent("/content.json");

    expect(getContent().knowledgeBase.en[0]).toEqual({ title: "T", content: "C", keywords: [] });
  });

  it.each([
    ["not an object", []],
    ["empty systemPrompt", validBody({ systemPrompt: "  " })],
    ["missing contact", validBody({ contact: undefined })],
    ["non-string contact", validBody({ contact: 5 })],
    ["missing knowledgeBase", validBody({ knowledgeBase: undefined })],
    ["empty en", validBody({ knowledgeBase: { en: [] } })],
    ["missing en", validBody({ knowledgeBase: { pl: [entry()] } })],
    ["en not an array", validBody({ knowledgeBase: { en: "x" } })],
    ["entry not an object", validBody({ knowledgeBase: { en: ["x"] } })],
    ["empty title", validBody({ knowledgeBase: { en: [entry("")] } })],
    ["empty content", validBody({ knowledgeBase: { en: [entry("T", "")] } })],
    ["keywords not an array", validBody({ knowledgeBase: { en: [entry("T", "C", "k")] } })],
    ["non-string keyword", validBody({ knowledgeBase: { en: [entry("T", "C", ["k", 1])] } })],
    ["invalid pl entry", validBody({ knowledgeBase: { en: [entry()], pl: [entry("")] } })],
  ])("keeps the defaults and warns once for %s", async (_name, body) => {
    fetchMock.mockResolvedValue(respondWith(body));

    await expect(loadContent("/content.json")).resolves.toBeUndefined();

    expect(getContent().systemPrompt).toBe(DEFAULT_CONTENT.systemPrompt);
    expect(getContent().knowledgeBase.en).toHaveLength(KNOWLEDGE_BASE.length + 1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("restores the defaults when a later load fails", async () => {
    fetchMock.mockResolvedValueOnce(respondWith(validBody()));
    await loadContent("/good.json");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });

    await loadContent("/missing.json");

    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("HTTP 404");
  });

  it("falls back to the defaults on invalid JSON", async () => {
    fetchMock.mockResolvedValue(okResponse("{not json"));

    await expect(loadContent("/content.json")).resolves.toBeUndefined();

    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the defaults when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    await expect(loadContent("/content.json")).resolves.toBeUndefined();

    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("offline");
  });

  it("rejects a response larger than 256 KB and accepts one at the limit", async () => {
    const bodyOfSize = (size: number): string => {
      const base = JSON.stringify(validBody({ systemPrompt: "" }));
      return JSON.stringify(validBody({ systemPrompt: "x".repeat(size - base.length) }));
    };
    expect(MAX_CONTENT_SIZE).toBe(262144);

    fetchMock.mockResolvedValueOnce(okResponse(bodyOfSize(MAX_CONTENT_SIZE + 1)));
    await loadContent("/big.json");
    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(okResponse(bodyOfSize(MAX_CONTENT_SIZE)));
    await loadContent("/limit.json");
    expect(getContent().contact).toBe("Call 123");
  });

  it("restores the defaults when called without a source", async () => {
    fetchMock.mockResolvedValue(respondWith(validBody()));
    await loadContent("/content.json");
    expect(getContent().contact).toBe("Call 123");

    await loadContent(undefined);

    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not let a slower earlier load overwrite a newer one", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const first = loadContent("/first.json");
    const second = loadContent("/second.json");
    resolvers[1]?.(respondWith(validBody({ contact: "Second" })));
    await second;
    resolvers[0]?.(respondWith(validBody({ contact: "First" })));
    await first;

    expect(getContent().contact).toBe("Second");
  });

  it("ignores a pending load once the defaults were restored", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));

    const slow = loadContent("/slow.json");
    await loadContent(undefined);
    resolve(respondWith(validBody()));
    await slow;

    expect(getContent().contact).toBe(DEFAULT_CONTENT.contact);
  });
});

describe("contentReady", () => {
  it("resolves immediately when nothing was loaded", async () => {
    await expect(contentReady()).resolves.toBeUndefined();
  });

  it("stays pending until the most recent load has settled", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    let settled = false;

    const load = loadContent("/content.json");
    const ready = contentReady().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolve(respondWith(validBody({ contact: "Loaded" })));
    await ready;
    await load;

    expect(settled).toBe(true);
    expect(getContent().contact).toBe("Loaded");
  });

  it("resolves even when the load failed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    void loadContent("/content.json");

    await expect(contentReady()).resolves.toBeUndefined();
  });
});

describe("default knowledge base sanity", () => {
  const languages = [
    ["en", KNOWLEDGE_BASE],
    ["pl", KNOWLEDGE_BASE_PL],
  ] as const;

  it.each(languages)("has no empty fields in %s entries", (_lang, entries) => {
    for (const item of entries) {
      expect(item.title.trim()).not.toBe("");
      expect(item.content.trim()).not.toBe("");
      expect(item.keywords.length).toBeGreaterThan(0);
      expect(item.keywords.every((word) => word.trim() !== "")).toBe(true);
    }
  });

  it.each(languages)("has unique titles in %s", (_lang, entries) => {
    const titles = entries.map((item) => item.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps English and Polish entries in the same number and order of topics", () => {
    expect(KNOWLEDGE_BASE.map((item) => item.title)).toEqual([
      "Opening Hours",
      "Address and Parking",
      "Pricing",
      "Appointments and Reservations",
      "Appointment Cancellation",
      "Dropping Off Your Bike",
      "Repair Estimates",
      "Repair Turnaround Time",
      "Bike Collection",
      "Warranty",
      "Payment Methods",
    ]);
    expect(KNOWLEDGE_BASE_PL.map((item) => item.title)).toEqual([
      "Godziny otwarcia",
      "Adres i parking",
      "Cennik",
      "Rezerwacje wizyt",
      "Anulowanie rezerwacji",
      "Dostarczenie roweru",
      "Kosztorys naprawy",
      "Czas realizacji napraw",
      "Odbiór roweru",
      "Gwarancja",
      "Płatności",
    ]);
  });

  it("does not repeat contact details outside the contact string", () => {
    const text = JSON.stringify([KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL]);

    expect(text).not.toContain("555");
    expect(text).not.toContain("@");
  });
});
