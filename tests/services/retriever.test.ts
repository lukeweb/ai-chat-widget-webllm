import { describe, expect, it } from "@jest/globals";
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_PL,
  type KnowledgeBase,
} from "../../src/config/knowledgeBase";
import {
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

const tokenizeForTest = (value: string): string[] => normalize(value).match(/[a-z0-9]+/g) ?? [];

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
      makeDocument("Content match", "repair"),
      makeDocument("Keyword match", "Other", ["repair"]),
      makeDocument("Repair", "Other"),
    ];

    const indexedDocuments = documents.map(makeIndexedDocument);

    expect(
      scoreDocuments(indexedDocuments, ["repair"]).map(
        ({ document }: SearchResult) => document.title
      )
    ).toEqual(["Repair", "Keyword match", "Content match"]);
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
