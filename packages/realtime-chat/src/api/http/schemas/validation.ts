export type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
    };

export function valid<T>(value: T): ValidationResult<T> {
  return {
    ok: true,
    value
  };
}

export function invalid<T>(message: string): ValidationResult<T> {
  return {
    ok: false,
    message
  };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

export function optionalStringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

export function positiveIntegerField(
  record: Record<string, unknown>,
  field: string
): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function nonNegativeIntegerFromString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
