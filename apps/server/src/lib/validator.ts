import type { Context, MiddlewareHandler, ValidationTargets } from "hono";
import type { ZodTypeAny } from "zod";

/**
 * 軽量バリデータ。検証済みデータを Hono 公式ストアに格納し、
 * valid<T>(c, target) で型付きで取り出す。"json" と "query" をサポート。
 */
export function zValidator(
  target: keyof ValidationTargets,
  schema: ZodTypeAny,
): MiddlewareHandler {
  return async (c, next) => {
    const raw =
      target === "json"
        ? await c.req.json().catch(() => undefined)
        : target === "query"
          ? c.req.query()
          : undefined;

    const result = schema.safeParse(raw);
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
    c.req.addValidatedData(target, result.data as object);
    await next();
  };
}

/** zValidator で検証済みの値を型付きで取得する */
export function valid<T>(c: Context, target: keyof ValidationTargets): T {
  return c.req.valid(target as never) as T;
}
