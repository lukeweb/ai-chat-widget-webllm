// Names that match the custom element grammar but are reserved by the HTML specification.
const RESERVED_ELEMENT_NAMES = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

export const parseNonEmptyString = (
  name: string,
  value: string | undefined,
  fallback: string
): string => {
  if (value === undefined) return fallback;

  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty`);
  return trimmed;
};

export const parseCustomElementName = (
  name: string,
  value: string | undefined,
  fallback: string
): string => {
  const parsed = parseNonEmptyString(name, value, fallback);
  if (!CUSTOM_ELEMENT_NAME.test(parsed) || RESERVED_ELEMENT_NAMES.has(parsed)) {
    throw new Error(
      `${name} must be a valid custom element name (lowercase, containing a hyphen); received: ${value}`
    );
  }
  return parsed;
};
