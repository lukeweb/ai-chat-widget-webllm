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
  price: [
    "cena",
    "ceny",
    "cenie",
    "cenę",
    "cenach",
    "cennik",
    "cennika",
    "cenniku",
    "koszt",
    "kosztu",
    "koszty",
    "kosztów",
    "kosztuje",
    "kosztują",
    "kosztować",
    "opłata",
    "opłaty",
    "opłat",
  ],
  estimate: ["kosztorys", "kosztorysu", "kosztorysie", "wycena", "wyceny", "wycenę"],
  payment: ["płatność", "płatności", "płatnością", "płacić", "zapłacić", "zapłata", "zapłaty"],
  cancel: ["anulować", "anulowanie", "anulowania", "anulacja", "odwołać", "odwołanie"],
  training: [
    "trening",
    "treningu",
    "treningi",
    "treningów",
    "treningom",
    "treningach",
    "treningiem",
  ],
  group: [
    "grupa",
    "grupy",
    "grupie",
    "grupę",
    "grupą",
    "grup",
    "grupach",
    "grupowy",
    "grupowa",
    "grupowe",
    "grupowych",
    "grupowego",
    "grupową",
    "grupowym",
    "grupowo",
  ],
  personal: [
    "personalny",
    "personalna",
    "personalne",
    "personalnych",
    "personalnego",
    "personalnym",
    "personalnie",
    "indywidualny",
    "indywidualna",
    "indywidualne",
    "indywidualnych",
    "indywidualnego",
    "indywidualnym",
    "indywidualnie",
  ],
  package: [
    "pakiet",
    "pakiety",
    "pakietów",
    "pakiecie",
    "pakietu",
    "pakietem",
    "karnet",
    "karnety",
    "karnetów",
    "karnecie",
    "karnetu",
  ],
  location: ["gdzie", "lokalizacja", "lokalizacji", "adres", "adresu", "adresie", "dojazd", "dojechać"],
  schedule: [
    "kiedy",
    "grafik",
    "grafiku",
    "grafiki",
    "grafikiem",
    "harmonogram",
    "harmonogramu",
    "harmonogramie",
    "rozkład",
    "rozkładu",
    "rozkładzie",
    "terminarz",
    "terminarza",
  ],
  trial: ["próbny", "próbna", "próbne", "próbnych", "próbnego", "próbnym", "próbnej", "próba"],
  kid: [
    "dziecko",
    "dziecka",
    "dziecku",
    "dzieci",
    "dzieciom",
    "dzieciach",
    "dziećmi",
    "dziecięcy",
    "dziecięca",
    "dziecięce",
    "dziecięcych",
  ],
  contact: ["kontakt", "kontaktu", "kontakty", "kontaktem", "kontaktować", "skontaktować"],
};

export const ENGLISH_TERM_GROUPS: Record<string, string[]> = {
  price: [
    "prices",
    "pricing",
    "cost",
    "costs",
    "fee",
    "fees",
    "charge",
    "charges",
    "rate",
    "rates",
    "tariff",
  ],
  booking: [
    "book",
    "books",
    "booked",
    "bookings",
    "reserve",
    "reserved",
    "reservation",
    "reservations",
  ],
  kid: ["kids", "child", "children", "childrens", "junior", "juniors"],
  package: ["packages", "bundle", "bundles"],
  schedule: ["schedules", "timetable", "timetables", "when"],
  location: ["where", "located", "location", "locations", "address", "addresses", "directions"],
};

// Characteristic Polish word forms (not the canonical names, which are English).
export const POLISH_TERM_FORMS = new Set(
  Object.values(POLISH_TERM_GROUPS).flatMap((forms) => forms.map(normalizeText))
);

// Canonical names map onto themselves so that canonicalization is idempotent.
export const POLISH_CANONICAL_TERMS = new Map<string, string>([
  ...Object.keys(POLISH_TERM_GROUPS).map((canonical) => [canonical, canonical] as const),
  ...Object.entries(POLISH_TERM_GROUPS).flatMap(([canonical, forms]) =>
    forms.map((form) => [normalizeText(form), canonical] as const)
  ),
]);

// Words that appear in almost every document of the domain and carry no ranking signal.
export const GENERIC_TOKENS = new Set(["training"]);

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
  "ile",
  "jaki",
  "dostepne",
  "chce",
  "mi",
  "mozna",
  "dla",
  "co",
  "nie",
  "tak",
  "mam",
  "moge",
  "prosze",
  "czesc",
  "witam",
  "dzien",
  "dobry",
  "to",
  "ten",
  "ta",
  "te",
  "tu",
  "tam",
  "tez",
  "juz",
  "czym",
  "ktory",
  "ktora",
  "ktore",
  "byc",
  "bedzie",
  "przy",
  "pod",
  "przez",
  "chcialbym",
  "chcialabym",
  "potrzebuje",
  "wiedziec",
  "podaj",
]);

// Polish stop words that are not also common English words, so they reliably signal Polish.
export const POLISH_LANGUAGE_MARKERS = new Set([
  "czy",
  "jak",
  "jaka",
  "jaki",
  "jakie",
  "jakich",
  "jest",
  "oraz",
  "sie",
  "sa",
  "ze",
  "ile",
  "dostepne",
  "chce",
  "mozna",
  "kiedy",
  "gdzie",
  "prosze",
  "czesc",
  "witam",
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
  "which",
  "with",
  "you",
  "your",
  "can",
  "could",
  "does",
  "did",
  "on",
  "at",
  "it",
  "my",
  "me",
  "about",
  "there",
  "have",
  "has",
  "be",
  "by",
  "from",
  "as",
  "or",
  "if",
  "this",
  "that",
  "we",
  "our",
  "us",
  "will",
  "would",
  "please",
  "tell",
  "am",
  "was",
  "were",
]);

/** Minimal English plural folding so that "brakes" matches "brake" and "days" matches "day". */
export const stemEnglish = (token: string): string => {
  if (token.length <= 3 || !/^[a-z]+$/.test(token)) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(?:sses|shes|ches|xes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("s") && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
};

// Canonical names map onto themselves so that canonicalization is idempotent.
const ENGLISH_CANONICAL_TERMS = new Map<string, string>([
  ...Object.keys(ENGLISH_TERM_GROUPS).map((canonical) => [canonical, canonical] as const),
  ...Object.entries(ENGLISH_TERM_GROUPS).flatMap(([canonical, forms]) =>
    forms.map((form) => [form, canonical] as const)
  ),
]);

/** English canonical form: known synonym groups first, then plural folding. */
export const canonicalizeEnglish = (token: string): string =>
  ENGLISH_CANONICAL_TERMS.get(token) ?? stemEnglish(token);

const POLISH_PREFIX_LENGTH = 5;
const MIN_POLISH_STEM_LENGTH = 3;

/**
 * Minimal Polish stemmer: known domain forms map to a canonical term, other words are cut to
 * a fixed-length prefix so that inflections ("treningi", "treningów") share one token.
 * Idempotent: stemming an already stemmed token returns it unchanged.
 */
export const stemPolish = (token: string): string => {
  const canonical = POLISH_CANONICAL_TERMS.get(token);
  if (canonical) return canonical;

  if (!/^[a-z]+$/.test(token)) return token;

  // Dropping trailing vowels joins short stems that differ only by an ending
  // ("walka"/"walki", "grupa"/"grupie") and keeps the result a fixed point.
  const prefix = token.slice(0, POLISH_PREFIX_LENGTH);
  const stem = prefix.replace(/[aeiouy]+$/, "");

  return stem.length >= MIN_POLISH_STEM_LENGTH ? stem : prefix;
};
