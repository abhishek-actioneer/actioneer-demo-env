/** JSON.stringify with BigInt → Number coercion */
export function safeStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? Number(v) : v,
    space,
  );
}
