import { afterEach, describe, expect, it } from "@jest/globals";
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_PL,
  type KnowledgeBase,
} from "../../src/config/knowledgeBase";
import { stemEnglish } from "../../src/services/retriever.helpers";
import {
  detectLanguage,
  retrieve,
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
      makeDocument("Repair", "Other"),
    ];

    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(
      scoreDocuments(indexedDocuments, ["repair"]).map(
        ({ document }: SearchResult) => document.title
      )
    ).toEqual(["Repair", "Keyword match", "Second keyword match"]);
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

    const result = await retrieve("Can you tell me more about that?", "What are your opening hours?");

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

describe("Polish term groups", () => {
  it("matches inflected Polish price and warranty questions", async () => {
    expect(await retrieve("Jakie są ceny napraw?")).toContain("Cennik");
    expect(await retrieve("Czy jest gwarancja na naprawy?")).toContain("Gwarancja");
  });
});
