import { describe, expect, it } from "@jest/globals";
import type { KnowledgeBase } from "../../src/config/knowledgeBase";
import {
  FOLLOW_UP_MAX_TOKENS,
  MAX_CONTEXT_CHARS,
  retrieve,
  scoreDocument,
} from "../../src/services/retriever";

// Fixture knowledge base: independent of the production content, bilingual, with entries that
// share many words (like "training") and differ only by one qualifier.
const PL: KnowledgeBase[] = [
  {
    title: "Cennik treningów grupowych",
    content: "Trening grupowy: 120 zł miesięcznie. Pojedyncze wejście: 30 zł.",
    keywords: ["cena", "koszt", "trening grupowy", "karnet"],
  },
  {
    title: "Cennik treningów personalnych",
    content: "Trening personalny: 150 zł za godzinę. Pakiet 10 treningów: 1300 zł.",
    keywords: ["cena", "koszt", "trening personalny", "indywidualny"],
  },
  {
    title: "Zajęcia dla dzieci",
    content: "Grupy dla dzieci w wieku 6-12 lat trenują we wtorki i czwartki o 17:00.",
    keywords: ["dzieci", "dziecko", "zajęcia dla dzieci", "młodzież"],
  },
  {
    title: "Cennik zajęć dla dzieci",
    content: "Zajęcia dla dzieci: 90 zł miesięcznie.",
    keywords: ["dzieci", "cena", "koszt"],
  },
  {
    title: "Grafik treningów",
    content: "Poniedziałek, środa i piątek o 18:00 oraz 19:30. Sobota o 10:00.",
    keywords: ["grafik", "harmonogram", "godziny", "kiedy", "treningi"],
  },
  {
    title: "Trening próbny",
    content: "Pierwszy trening próbny jest bezpłatny. Zapisy telefonicznie.",
    keywords: ["próbny", "pierwszy", "darmowy", "zapisy"],
  },
  {
    title: "Kontakt i lokalizacja",
    content: "Klub Pantera, ul. Długa 5, Kraków. Telefon: 500 100 200.",
    keywords: ["kontakt", "telefon", "adres", "lokalizacja", "gdzie"],
  },
];

const EN: KnowledgeBase[] = [
  {
    title: "Group training prices",
    content: "Group training: 120 PLN per month. Single entry: 30 PLN.",
    keywords: ["price", "cost", "group training", "pass"],
  },
  {
    title: "Personal training prices",
    content: "Personal training: 150 PLN per hour. 10 session package: 1300 PLN.",
    keywords: ["price", "cost", "personal training", "individual"],
  },
  {
    title: "Classes for kids",
    content: "Kids groups aged 6-12 train on Tuesdays and Thursdays at 5:00 PM.",
    keywords: ["kids", "children", "child", "youth"],
  },
  {
    title: "Training schedule",
    content: "Monday, Wednesday and Friday at 6:00 PM and 7:30 PM. Saturday at 10:00 AM.",
    keywords: ["schedule", "timetable", "hours", "when"],
  },
  {
    title: "Contact and location",
    content: "Pantera Club, 5 Dluga Street, Krakow. Phone: 500 100 200.",
    keywords: ["contact", "phone", "address", "location", "where"],
  },
];

const KB = { en: EN, pl: PL };

const titles = async (query: string, previous?: string): Promise<string[]> =>
  (await retrieve(query, previous, KB))
    .split("\n\n")
    .filter(Boolean)
    .map((entry) => entry.split("\n")[0] as string);

describe("Polish retrieval against a club knowledge base", () => {
  it.each([
    ["Ile kosztuje trening grupowy?", "Cennik treningów grupowych"],
    ["ile kosztuje trening grupowy", "Cennik treningów grupowych"],
    ["Ile kosztują treningi personalne?", "Cennik treningów personalnych"],
    ["ile kosztuje trening indywidualny", "Cennik treningów personalnych"],
    ["Czy macie karnet?", "Cennik treningów grupowych"],
    ["Kiedy są zajęcia dla dzieci?", "Zajęcia dla dzieci"],
    ["Czy macie zajecia dla dziecka?", "Zajęcia dla dzieci"],
    ["Jaki jest grafik treningów?", "Grafik treningów"],
    ["grafik zajec", "Grafik treningów"],
    ["Czy można przyjść na trening próbny?", "Trening próbny"],
    ["Gdzie się znajdujecie?", "Kontakt i lokalizacja"],
    ["jaki macie numer telefonu", "Kontakt i lokalizacja"],
  ])("%s", async (query, expectedTop) => {
    expect((await titles(query))[0]).toBe(expectedTop);
  });

  it("does not mix group and personal prices for a group question", async () => {
    const result = await titles("Ile kosztuje trening grupowy?");

    expect(result).toContain("Cennik treningów grupowych");
    expect(result).not.toContain("Cennik treningów personalnych");
  });

  it("treats 'pakiet' and 'karnet' as the same thing", async () => {
    expect(await titles("Czy są pakiety?")).toContain("Cennik treningów grupowych");
  });

  it("returns both prices for a general price question", async () => {
    const result = await titles("Ile kosztują treningi?");

    expect(result).toEqual(
      expect.arrayContaining(["Cennik treningów grupowych", "Cennik treningów personalnych"])
    );
  });

  it("does not let function words such as 'dla' decide the ranking", async () => {
    const [top] = await titles("Ile kosztuje trening dla dorosłych?");

    expect(top).not.toBe("Zajęcia dla dzieci");
  });

  it("matches a number from the question against the content", async () => {
    const [top] = await titles("Czy jest trening o 19:30?");

    expect(top).toBe("Grafik treningów");
  });

  it("returns nothing for an unrelated question", async () => {
    expect(await titles("Jaka jest dzisiaj pogoda w Paryżu?")).toEqual([]);
  });
});

describe("English retrieval against a club knowledge base", () => {
  it.each([
    ["How much is group training?", "Group training prices"],
    ["What is the price of personal training?", "Personal training prices"],
    ["What are the prices?", "Group training prices"],
    ["Do you have classes for children?", "Classes for kids"],
    ["When are the trainings?", "Training schedule"],
    ["Where are you located?", "Contact and location"],
  ])("%s", async (query, expectedTop) => {
    const result = await titles(query);

    expect(result[0]).toBe(expectedTop);
  });

  it("unifies synonyms such as pricing and price, kids and children", async () => {
    expect((await titles("pricing for group training"))[0]).toBe("Group training prices");
    expect((await titles("programs for kids"))[0]).toBe("Classes for kids");
  });
});

describe("language choice", () => {
  it("searches the Polish entries for short Polish questions without diacritics", async () => {
    const [top] = await titles("dzieci");

    expect(top).toBe("Zajęcia dla dzieci");
  });

  it("searches the English entries for English questions", async () => {
    const [top] = await titles("training schedule");

    expect(top).toBe("Training schedule");
  });

  it("falls back to the English entries when there are no Polish ones", async () => {
    const result = await retrieve("grafik", undefined, { en: EN });

    expect(result).toBe("");
  });
});

describe("follow-up questions", () => {
  it("combines a short follow-up with the previous question", async () => {
    const followUp = await titles("A dla dzieci?");
    const combined = await titles("A dla dzieci?", "Ile kosztuje trening grupowy?");

    expect(followUp[0]).toBeDefined();
    expect(combined[0]).toBe("Cennik zajęć dla dzieci");
  });

  it("does not pull in entries that match only the previous message", async () => {
    const result = await titles("A dla dzieci?", "Ile kosztuje trening grupowy?");

    expect(result).not.toContain("Cennik treningów grupowych");
  });

  it("keeps the follow-up threshold small", () => {
    expect(FOLLOW_UP_MAX_TOKENS).toBeLessThanOrEqual(3);
  });
});

describe("generic tokens", () => {
  it("ignores 'training' after canonicalization in every inflected form", () => {
    const indexed = {
      document: PL[0] as KnowledgeBase,
      language: "pl",
      titleTokens: new Set(["training"]),
      keywordTokens: new Set(["training"]),
      contentTokens: new Set(["training"]),
    };

    for (const word of ["trening", "treningi", "treningow"]) {
      expect(scoreDocument(indexed, [word]).score).toBe(0);
    }
  });

  it("ignores 'trainings' in English as well", () => {
    const indexed = {
      document: EN[0] as KnowledgeBase,
      language: "en",
      titleTokens: new Set(["training"]),
      keywordTokens: new Set(["training"]),
      contentTokens: new Set(["training"]),
    };

    expect(scoreDocument(indexed, ["trainings"]).score).toBe(0);
  });
});

describe("context size", () => {
  it("never exceeds the context limit and keeps the best entry", async () => {
    const longText = `${"Trening grupowy w klubie. ".repeat(200)}Koniec.`;
    const base: KnowledgeBase[] = [
      { title: "Długi opis grafiku", content: longText, keywords: ["grafik"] },
      { title: "Drugi opis grafiku", content: longText, keywords: ["grafik"] },
    ];

    const result = await retrieve("grafik", undefined, { en: base, pl: base });

    expect(result.startsWith("Długi opis grafiku")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(result).not.toContain("Drugi opis grafiku");
  });

  it("keeps whole entries when they fit", async () => {
    const result = await retrieve("Ile kosztuje trening grupowy?", undefined, KB);

    expect(result).toContain("Trening grupowy: 120 zł miesięcznie. Pojedyncze wejście: 30 zł.");
  });
});
