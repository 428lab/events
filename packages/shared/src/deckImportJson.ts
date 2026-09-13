/** Bounded JSON reader shared by the browser worker and import API. Never accepts duplicate keys. */
export const DECK_IMPORT_MAX_BYTES = 1_048_576;
export const DECK_IMPORT_MAX_DEPTH = 6;

export class DeckImportJsonError extends Error {
  constructor(
    public readonly code: "invalid_json" | "invalid_encoding" | "too_large",
    public readonly line = 1,
    public readonly column = 1,
  ) {
    super(code);
  }
}

export function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** TextEncoder silently replaces lone surrogates, so check before encoding pasted text. */
export function deckImportBytes(text: string): Uint8Array {
  if (hasLoneSurrogate(text)) throw new DeckImportJsonError("invalid_encoding");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > DECK_IMPORT_MAX_BYTES) throw new DeckImportJsonError("too_large");
  return bytes;
}

export function decodeDeckImport(bytes: Uint8Array): string {
  if (bytes.byteLength > DECK_IMPORT_MAX_BYTES) throw new DeckImportJsonError("too_large");
  // ignoreBOM preserves it so it cannot silently disappear during decoding.
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) throw new Error();
    return text;
  } catch {
    throw new DeckImportJsonError("invalid_encoding");
  }
}

export function parseDeckImportJson(input: string | Uint8Array): unknown {
  const text = decodeDeckImport(typeof input === "string" ? deckImportBytes(input) : input);
  let pos = 0;
  function fail(at = pos): never {
    const prefix = text.slice(0, at);
    const lines = prefix.split(/\r\n|\r|\n/);
    throw new DeckImportJsonError("invalid_json", lines.length, lines[lines.length - 1].length + 1);
  }
  function space() {
    while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++;
  }
  function string(): string {
    const start = pos++;
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, pos)); } catch { return fail(start); }
        if (hasLoneSurrogate(value)) fail(start);
        return value;
      }
      if (ch.charCodeAt(0) < 0x20) fail(pos - 1);
      if (ch === "\\") {
        const escaped = text[pos++];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(pos, pos + 4))) fail(pos);
          pos += 4;
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail(pos - 1);
      }
    }
    return fail();
  }
  function value(depth: number): unknown {
    space();
    const ch = text[pos];
    if (ch === "{" || ch === "[") {
      if (depth > DECK_IMPORT_MAX_DEPTH) fail();
      const object = ch === "{";
      const out: Record<string, unknown> = Object.create(null);
      const array: unknown[] = [];
      const seen = new Set<string>();
      const close = object ? "}" : "]";
      pos++;
      space();
      if (text[pos] === close) { pos++; return object ? out : array; }
      while (true) {
        space();
        if (object) {
          if (text[pos] !== '"') fail();
          const start = pos;
          const key = string();
          if (seen.has(key)) fail(start);
          seen.add(key);
          space();
          if (text[pos++] !== ":") fail(pos - 1);
          out[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        space();
        if (text[pos] === close) { pos++; return object ? out : array; }
        if (text[pos++] !== ",") fail(pos - 1);
      }
    }
    if (ch === '"') return string();
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, pos)) { pos += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(pos));
    if (!match) return fail();
    pos += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail(pos - match[0].length);
    return number === 0 ? 0 : number;
  }
  const result = value(1);
  space();
  if (pos !== text.length) fail();
  return result;
}
