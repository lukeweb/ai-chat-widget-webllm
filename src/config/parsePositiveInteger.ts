export const parsePositiveInteger = (
  name: string,
  value: string | undefined,
  fallback?: number
): number => {
  if (value === undefined && fallback !== undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received: ${value}`);
  }
  return parsed;
};
