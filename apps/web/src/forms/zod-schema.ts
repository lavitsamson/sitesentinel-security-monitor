import type { TypedSchema, TypedSchemaError } from 'vee-validate';
import type { z } from 'zod';

/**
 * Lets VeeValidate validate with the same zod 4 schemas the API uses.
 * (The official @vee-validate/zod adapter only supports zod 3.)
 */
export function toTypedSchema<T extends z.ZodType>(
  schema: T,
): TypedSchema<z.input<T>, z.output<T>> {
  return {
    __type: 'VVTypedSchema',
    async parse(values) {
      const result = await schema.safeParseAsync(values);
      if (result.success) return { value: result.data, errors: [] };

      const byPath = new Map<string, string[]>();
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        byPath.set(path, [...(byPath.get(path) ?? []), issue.message]);
      }
      const errors: TypedSchemaError[] = [...byPath].map(([path, messages]) => ({
        path,
        errors: messages,
      }));
      return { errors };
    },
  };
}
