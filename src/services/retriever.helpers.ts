export const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l");

export const POLISH_TERM_GROUPS: Record<string, string[]> = {
  hour: [
    "godzina",
    "godziny",
    "godzin",
    "godzinach",
    "godzinami",
    "godzinę",
    "godziną",
    "godzinny",
    "godzinnych",
  ],
  open: [
    "otwarty",
    "otwarta",
    "otwarte",
    "otwarci",
    "otwarcia",
    "otwarcie",
    "czynny",
    "czynna",
    "czynne",
    "czynni",
    "działa",
    "działają",
    "funkcjonuje",
  ],
  workshop: [
    "warsztat",
    "warsztatu",
    "warsztacie",
    "warsztatem",
    "warsztaty",
    "warsztatów",
    "warsztatami",
  ],
};

export const POLISH_CANONICAL_TERMS = new Map(
  Object.entries(POLISH_TERM_GROUPS).flatMap(([canonical, forms]) =>
    forms.map((form) => [normalizeText(form), canonical] as const)
  )
);

export const POLISH_STOP_WORDS = new Set([
  "a",
  "aby",
  "ale",
  "czy",
  "do",
  "i",
  "jak",
  "jaka",
  "jakie",
  "jakich",
  "jest",
  "na",
  "o",
  "od",
  "oraz",
  "po",
  "sie",
  "sa",
  "w",
  "we",
  "z",
  "ze",
]);

export const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "for",
  "how",
  "i",
  "in",
  "is",
  "of",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
  "your",
]);
