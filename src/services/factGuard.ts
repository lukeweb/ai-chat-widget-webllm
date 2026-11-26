// Digit literals such as 49, 9:00, 9.30, 15.08, 1,5. Number words ("dziewiąta", "nine") are not checked.
const NUMBER_LITERAL = /\d+(?:[.,:]\d+)*/g;
// "1 200" (also with a non-breaking space, which \s matches) is one number with a thousands separator.
const THOUSANDS_SPACE = /(\d)\s(?=\d{3}(?!\d))/g;

/**
 * Canonical form of a number literal, so equivalent spellings compare equal:
 * `9:00` = `9.00` = `9` = `09`, `49,00` = `49`, `9.30` = `9:30`.
 */
const canonicalNumber = (literal: string): string => {
  const groups = literal.split(/[.,:]/).map((group) => group.replace(/^0+(?=\d)/, ""));
  while (groups.length > 1 && /^0+$/.test(groups[groups.length - 1] ?? "")) groups.pop();
  return groups.join(":");
};

/**
 * All readings of a literal. A comma or dot followed by exactly three digits may be a thousands
 * separator (`1,200` or `1.200` = `1200`) or a decimal one, so both readings are kept.
 */
const numberReadings = (literal: string): string[] => {
  const readings = [canonicalNumber(literal)];
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(literal)) readings.push(literal.replace(/[.,]/g, ""));
  return readings;
};

const numbersIn = (text: string): string[][] =>
  (text.replace(THOUSANDS_SPACE, "$1").match(NUMBER_LITERAL) ?? []).map(numberReadings);

/**
 * Returns the numbers in `answer` that appear neither in the knowledge-base `context` nor in the
 * user's `question`. An empty result means every number in the answer is supported.
 */
export const findUnsupportedNumbers = (
  answer: string,
  context: string,
  question: string
): string[] => {
  const supported = new Set([...numbersIn(context), ...numbersIn(question)].flat());
  const unsupported = numbersIn(answer)
    .filter((readings) => !readings.some((reading) => supported.has(reading)))
    .map(([canonical]) => canonical ?? "");
  return [...new Set(unsupported)];
};
