import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { loadContent } from "../../src/services/content";
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_PL,
  type KnowledgeBase,
} from "../../src/config/knowledgeBase";
import { GENERIC_TOKENS, stemEnglish, stemPolish } from "../../src/services/retriever.helpers";
import {
  detectLanguage,
  formatContext,
  retrieve,
  retrieveEntries,
  scoreDocument,
  scoreDocuments,
  type SearchResult,
} from "../../src/services/retriever";

const makeDocument = (title: string, content: string, keywords: string[] = []): KnowledgeBase => ({
  title,
  content,
  keywords,
});

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l");

const tokenizeForTest = (value: string): string[] =>
  (normalize(value).match(/[a-z0-9]+/g) ?? []).map(stemEnglish);

const makeIndexedDocument = (document: KnowledgeBase) => ({
  document,
  titleTokens: new Set(tokenizeForTest(document.title)),
  keywordTokens: new Set(document.keywords.flatMap(tokenizeForTest)),
  contentTokens: new Set(tokenizeForTest(document.content)),
});

describe("scoreDocument", () => {
  it.each([
    ["English", makeDocument("Repair", "Repair cost", ["repair"]), "repair"],
    ["Polish", makeDocument("Płatności", "Akceptujemy płatności", ["płatności"]), "platnosci"],
  ])("scores %s title, keyword, and content matches", (_language, document, token) => {
    const indexed = makeIndexedDocument(document);

    expect(scoreDocument(indexed, [token])).toEqual({
      document,
      score: 6,
    });
  });

  it("matches case-insensitively and treats accented and unaccented Polish forms alike", () => {
    const document = makeDocument("PŁATNOŚCI", "Płatności kartą", ["Płatności"]);
    const indexed = makeIndexedDocument(document);

    expect(scoreDocument(indexed, ["platnosci"]).score).toBe(6);
  });

  it("does not match a substring inside an unrelated word or an empty token", () => {
    const document = makeDocument("Chair", "We repair chairs", ["chair"]);
    const indexed = makeIndexedDocument(document);

    expect(scoreDocument(indexed, ["air", ""]).score).toBe(0);
  });
});

describe("scoreDocuments", () => {
  it.each([
    ["English", KNOWLEDGE_BASE, "hours", "Opening Hours"],
    ["Polish", KNOWLEDGE_BASE_PL, "godziny", "Godziny otwarcia"],
  ])("ranks %s documents by relevance", (_language, documents, token, expectedTitle) => {
    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(scoreDocuments(indexedDocuments, [token])[0]?.document.title).toBe(expectedTitle);
  });

  it("returns at most three relevant documents and excludes zero-score entries", () => {
    const documents = [
      makeDocument("Irrelevant", "Nothing related"),
      makeDocument("Keyword match", "Other", ["repair"]),
      makeDocument("Second keyword match", "Other", ["repair"]),
      makeDocument("Third keyword match", "Other", ["repair"]),
      makeDocument("Fourth keyword match", "Other", ["repair"]),
    ];

    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(
      scoreDocuments(indexedDocuments, ["repair"]).map(
        ({ document }: SearchResult) => document.title
      )
    ).toEqual(["Keyword match", "Second keyword match", "Third keyword match"]);
  });

  it("ignores documents that only match through a single content word", () => {
    const documents = [
      makeDocument("Drop off", "Bring it in", ["bike"]),
      makeDocument("Pricing", "Bike inspection costs 49 USD"),
    ];
    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(
      scoreDocuments(indexedDocuments, ["bike"]).map(({ document }: SearchResult) => document.title)
    ).toEqual(["Drop off"]);
  });

  it("drops documents scoring far below the best match even when above the minimum score", () => {
    const documents = [
      makeDocument("Repair", "Other", ["repair"]), // title 3 + keyword 2 = 5
      makeDocument("Weak", "Other", ["repair"]), // keyword 2: above the minimum, below half of 5
    ];
    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(
      scoreDocuments(indexedDocuments, ["repair"]).map(
        ({ document }: SearchResult) => document.title
      )
    ).toEqual(["Repair"]);
  });

  it("returns an empty list when no documents match", () => {
    const document = makeDocument("Hours", "Open daily");
    const indexed = makeIndexedDocument(document);

    expect(scoreDocuments([indexed], ["pricing"])).toEqual([]);
  });
});

describe("retrieve", () => {
  it("retrieves relevant English knowledge-base entries", async () => {
    const result = await retrieve("What are your opening hours?");

    expect(result).toContain("Opening Hours\n");
  });

  it("retrieves relevant Polish knowledge-base entries", async () => {
    const result = await retrieve("Jakie są godziny otwarcia?");

    expect(result).toContain("Godziny otwarcia\n");
  });

  it("detects Polish queries without diacritics", async () => {
    const result = await retrieve("godziny otwarcia");

    expect(result).toContain("Godziny otwarcia\n");
    expect(result).not.toContain("Opening Hours\n");
  });

  it("returns the same opening-hours source for equivalent sentence structures", async () => {
    const queryA = await retrieve("Jakie są godziny otwarcia warsztatu?");
    const queryB = await retrieve("W jakich godzinach jest otwarty warsztat?");

    expect(queryB).toBe(queryA);
    expect(queryA).toContain("Godziny otwarcia\n");
  });

  it("matches Polish inflections, singular and plural forms, and common synonyms", async () => {
    const singular = await retrieve("Kiedy warsztat jest czynny?");
    const plural = await retrieve("Czy warsztaty są otwarte?");

    expect(plural).toBe(singular);
    expect(singular).toContain("Godziny otwarcia\n");
  });

  it("normalizes Polish diacritics before tokenizing", async () => {
    const accented = await retrieve("Jakie są godziny otwarcia w święta?");
    const unaccented = await retrieve("Jakie sa godziny otwarcia w swieta?");
    const payments = await retrieve("Jakie są metody płatności?");

    expect(accented).toBe(unaccented);
    expect(accented).toContain("Godziny otwarcia\n");
    expect(payments).toContain("Płatności\n");
  });

  it("tolerates a one-character spelling mistake in a relevant term", async () => {
    const result = await retrieve("Jakie są godziny otwarciaa warsztatu?");

    expect(result).toContain("Godziny otwarcia\n");
  });

  it("does not return knowledge for an unrelated Polish query", async () => {
    await expect(retrieve("Czy telewizory latają po kosmosie? ")).resolves.toBe("");
  });

  it.each(["", "qzxv nonsense", "xyzxyz xyzxyz"])(
    "returns an empty string when no knowledge-base entry matches %j",
    async (query) => {
      await expect(retrieve(query)).resolves.toBe("");
    }
  );
});

describe("retrieve follow-ups", () => {
  it("falls back to the previous user message when the question has no context of its own", async () => {
    expect(await retrieve("Can you tell me more about that?")).toBe("");

    const result = await retrieve(
      "Can you tell me more about that?",
      "What are your opening hours?"
    );

    expect(result).toContain("Opening Hours");
  });

  it("does not use the previous message when the question already matches", async () => {
    const result = await retrieve("Do you accept cash?", "What are your opening hours?");

    expect(result).toContain("Payment Methods");
    expect(result).not.toContain("Opening Hours");
  });
});

describe("detectLanguage", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("detects Polish by diacritics even for very short input", () => {
    expect(detectLanguage("cześć")).toBe("pl");
  });

  it("detects clear English and Polish sentences", () => {
    expect(detectLanguage("how much does a brake adjustment cost")).toBe("en");
    expect(detectLanguage("ile kosztuje regulacja hamulców")).toBe("pl");
  });

  it("falls back to the page language for undetectable input", () => {
    Object.defineProperty(globalThis, "document", {
      value: { documentElement: { lang: "pl-PL" } },
      configurable: true,
    });

    expect(detectLanguage("hi")).toBe("pl");
  });

  it("defaults to English without a page language", () => {
    expect(detectLanguage("hi")).toBe("en");
    expect(detectLanguage("   ")).toBe("en");
  });
});

describe("English plural handling", () => {
  it.each([
    ["Do you adjust brakes?", "Pricing"],
    ["How many days does a service take?", "Repair Turnaround Time"],
  ])("matches singular and plural forms: %s", async (question, title) => {
    expect(await retrieve(question)).toContain(title);
  });

  it.each([
    ["brakes", "brake"],
    ["days", "day"],
    ["batteries", "battery"],
    ["watches", "watch"],
    ["glass", "glass"],
    ["bus", "bus"],
    ["is", "is"],
  ])("stems %s to %s", (word, stem) => {
    expect(stemEnglish(word)).toBe(stem);
  });
});

describe("stemPolish", () => {
  it.each([
    ["zajecia", "zajec"],
    ["zajeciach", "zajec"],
    ["trener", "tren"],
    ["trenera", "tren"],
    ["walka", "walk"],
    ["walki", "walk"],
    ["dorosly", "doros"],
    ["doroslych", "doros"],
    ["napraw", "napr"],
  ])("cuts inflected word %s to a shared stem", (word, stem) => {
    expect(stemPolish(word)).toBe(stem);
  });

  it.each([
    ["godziny", "hour"],
    ["cennik", "price"],
    ["kosztuje", "price"],
    ["treningow", "training"],
    ["grupowych", "group"],
    ["indywidualny", "personal"],
    ["personalne", "personal"],
    ["pakiety", "package"],
    ["karnetow", "package"],
    ["dzieci", "kid"],
    ["dziecka", "kid"],
    ["probny", "trial"],
    ["grafik", "schedule"],
    ["kosztorys", "estimate"],
  ])("maps the domain form %s to the canonical term %s", (word, canonical) => {
    expect(stemPolish(word)).toBe(canonical);
  });

  it("joins short stems that differ only by an ending", () => {
    expect(stemPolish("grupa")).toBe(stemPolish("grupie"));
    expect(stemPolish("karta")).toBe(stemPolish("karty"));
  });

  it("keeps short words and numbers unchanged", () => {
    expect(stemPolish("dnia")).toBe("dnia");
    expect(stemPolish("24")).toBe("24");
  });

  it("is idempotent, including for canonical names", () => {
    for (const word of [
      "godziny",
      "cennik",
      "treningow",
      "kosztuje",
      "warsztat",
      "pakiety",
      "walki",
      "zajeciach",
      "sztuki",
      "24",
      "9:00",
    ]) {
      const once = stemPolish(word);
      expect(stemPolish(once)).toBe(once);
    }
  });
});

describe("query tokenization", () => {
  it("matches canonical terms without stemming the query twice", async () => {
    const result = await retrieve("Czy jest gwarancja na naprawy?");

    expect(result).toContain("Gwarancja\n");
  });

  it("matches Polish inflections of words missing from the term groups", async () => {
    const result = await retrieve("Ile kosztuje przeglad?");

    expect(result).toContain("Cennik\n");
  });

  it("ignores generic tokens when scoring", () => {
    const document = makeDocument("Training", "Training info", ["training"]);

    expect(GENERIC_TOKENS.has("training")).toBe(true);
    expect(scoreDocument(makeIndexedDocument(document), ["training"]).score).toBe(0);
  });
});

describe("Polish query language detection", () => {
  it.each([
    "ile kosztuje przeglad",
    "jakie sa godziny otwarcia",
    "czy mozna zaplacic karta",
    "chce umowic wizyte",
  ])("detects Polish without diacritics: %s", (query) => {
    expect(detectLanguage(query)).toBe("pl");
  });

  it.each([
    "how much does a service cost",
    "what are the training prices",
    "do you offer group packages",
  ])("does not mistake English for Polish: %s", (query) => {
    expect(detectLanguage(query)).toBe("en");
  });

  it("retrieves from the Polish knowledge base for a question without diacritics", async () => {
    const result = await retrieve("ile kosztuje przeglad roweru");

    expect(result).toContain("Cennik\n");
    expect(result).not.toContain("Pricing\n");
  });
});

describe("relative score threshold", () => {
  it("keeps documents scoring at least 70% of the best match and drops the rest", () => {
    const documents = [
      makeDocument("Repair", "Repair", ["repair"]), // title 3 + keyword 2 + content 1 = 6
      makeDocument("Repair close", "Other", ["repair"]), // title 3 + keyword 2 = 5 (83%)
      makeDocument("Repair far", "Other"), // title 3 only (50%)
      makeDocument("Other", "Repair", ["repair"]), // keyword 2 + content 1 = 3 (50%)
    ];

    expect(
      scoreDocuments(documents.map(makeIndexedDocument), ["repair"]).map(
        ({ document }: SearchResult) => document.title
      )
    ).toEqual(["Repair", "Repair close"]);
  });
});

describe("Polish term groups", () => {
  it("matches inflected Polish price and warranty questions", async () => {
    expect(await retrieve("Jakie są ceny napraw?")).toContain("Cennik");
    expect(await retrieve("Czy jest gwarancja na naprawy?")).toContain("Gwarancja");
  });
});

describe("retrieve with the generated contact entry", () => {
  it.each([
    ["What is your phone number?", "Contact\nPhone: +1 555 0100."],
    ["Jaki jest wasz numer telefonu?", "Kontakt\nPhone: +1 555 0100."],
  ])("finds contact details for %j", async (question, expected) => {
    expect(await retrieve(question)).toContain(expected);
  });
});

describe("retrieve with loaded content", () => {
  const entry = (title: string, content: string, keywords: string[]) => ({
    title,
    content,
    keywords,
  });
  const mockFetch = (body: unknown) => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
  };
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await loadContent(undefined);
  });

  it("uses the knowledge base loaded through loadContent", async () => {
    mockFetch({
      systemPrompt: "Prompt {{contact}}",
      contact: "Call 123",
      knowledgeBase: { en: [entry("Tyres", "We sell tyres.", ["tyres", "tyre"])] },
    });

    await loadContent("/content.json");

    expect(await retrieve("Do you sell tyres?")).toBe("Tyres\nWe sell tyres.");
    expect(await retrieve("What are your opening hours?")).toBe("");
    expect(await retrieve("What is your phone number?")).toContain("Contact\nCall 123");
  });

  it("falls back to the English knowledge base for Polish queries when no Polish one exists", async () => {
    mockFetch({
      systemPrompt: "Prompt",
      contact: "Call 123",
      knowledgeBase: { en: [entry("Godziny", "Open daily.", ["godziny"])] },
    });

    await loadContent("/content.json");

    expect(await retrieve("godziny otwarcia")).toContain("Godziny\nOpen daily.");
  });

  it("prefers the Polish knowledge base for Polish queries when present", async () => {
    mockFetch({
      systemPrompt: "Prompt",
      contact: "Call 123",
      knowledgeBase: {
        en: [entry("Hours", "English hours.", ["hours"])],
        pl: [entry("Godziny", "Polskie godziny.", ["godziny"])],
      },
    });

    await loadContent("/content.json");

    expect(await retrieve("godziny otwarcia")).toBe("Godziny\nPolskie godziny.");
    expect(await retrieve("What are the hours?")).toBe("Hours\nEnglish hours.");
  });
});

describe("retrieveEntries", () => {
  const knowledgeBase = { en: KNOWLEDGE_BASE, pl: KNOWLEDGE_BASE_PL };
  const hours = makeDocument("Opening hours", "Open 9:00–18:00.", ["hours", "open"]);
  const saturday = makeDocument("Saturday hours", "Saturday 10:00–14:00.", ["hours", "saturday"]);
  const price = makeDocument("Price list", "Service: 49 USD.", ["price", "cost"]);

  it("returns the knowledge-base language with the results", () => {
    const polish = retrieveEntries("Jakie są godziny otwarcia?", undefined, knowledgeBase);
    const english = retrieveEntries("What are your opening hours?", undefined, knowledgeBase);

    expect(polish.language).toBe("pl");
    expect(polish.results[0]?.document.title).toBe("Godziny otwarcia");
    expect(english.language).toBe("en");
    expect(english.results[0]?.document.title).toBe("Opening Hours");
  });

  it("limits the number of entries with maxDocuments", () => {
    const base = { en: [hours, saturday, price] };
    // "hours" matches both hour entries equally.
    const unlimited = retrieveEntries("hours", undefined, base);
    const limited = retrieveEntries("hours", undefined, base, { maxDocuments: 1 });

    expect(unlimited.results.length).toBeGreaterThan(1);
    expect(limited.results).toHaveLength(1);
    expect(limited.results[0]).toEqual(unlimited.results[0]);
  });

  it("keeps a second entry only when it scores close to the best one", () => {
    const base = {
      en: [
        makeDocument("Tyre repair", "We repair tyres and wheels.", ["tyre", "wheel", "puncture"]),
        makeDocument("Wheel truing", "Wheel truing and tyre fitting.", ["wheel", "tyre", "spokes"]),
        // An unrelated entry, so words shared by the two above count as specific.
        makeDocument("Gift cards", "Gift cards for any amount.", ["gift", "card"]),
      ],
    };
    const titles = (options?: { minSecondScoreRatio: number }) =>
      retrieveEntries("wheel tyre puncture", undefined, base, options).results.map(
        ({ document }) => document.title
      );

    // The second entry scores about 74% of the best: inside the default relevance threshold,
    // below the 90% the lite profile asks for.
    expect(titles()).toEqual(["Tyre repair", "Wheel truing"]);
    expect(titles({ minSecondScoreRatio: 0.9 })).toEqual(["Tyre repair"]);
    expect(titles({ minSecondScoreRatio: 0.7 })).toEqual(["Tyre repair", "Wheel truing"]);
  });

  it("keeps both entries when they match equally", () => {
    const base = { en: [hours, saturday] };
    expect(retrieveEntries("hours", undefined, base, { minSecondScoreRatio: 0.9 }).results).toHaveLength(2);
  });

  it("uses the previous message for short follow-ups, like retrieve", () => {
    const followUp = retrieveEntries("A w sobotę?", "Jakie są godziny otwarcia?", knowledgeBase, {
      maxDocuments: 1,
    });

    expect(followUp.language).toBe("pl");
    expect(followUp.results[0]?.document.title).toBe("Godziny otwarcia");
  });

  it("returns no results when nothing matches", () => {
    expect(retrieveEntries("quantum chromodynamics", undefined, { en: [hours, price] })).toEqual({
      language: "en",
      results: [],
    });
  });
});

describe("formatContext", () => {
  it("joins entries and respects a custom character limit", () => {
    const first = makeDocument("First", "A".repeat(50));
    const second = makeDocument("Second", "B".repeat(50));
    const results = [first, second].map((document) => ({ document, score: 5 }));

    expect(formatContext(results)).toBe(`First\n${"A".repeat(50)}\n\nSecond\n${"B".repeat(50)}`);
    expect(formatContext(results, 80)).toBe(`First\n${"A".repeat(50)}`);
  });
});
