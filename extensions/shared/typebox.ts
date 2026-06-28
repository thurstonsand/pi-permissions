import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export function parseTypeBoxValue<T extends TSchema>(
  schema: T,
  value: unknown,
  context: string,
): Static<T> {
  if (Value.Check(schema, value)) {
    return value as Static<T>;
  }

  const firstError = Value.Errors(schema, value)[0];
  if (!firstError) {
    throw new Error(`${context}: invalid value.`);
  }

  const path = firstError.instancePath.length > 0 ? firstError.instancePath : "/";
  throw new Error(`${context}: ${path} ${firstError.message}`);
}
