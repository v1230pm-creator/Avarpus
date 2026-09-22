/**
 * Minimal TOML reader for `.replit`.
 *
 * The workspace tooling writes `.replit` itself, so the file only ever uses
 * the plain subset handled here: tables, arrays of tables, dotted keys,
 * basic/literal strings (single- and multi-line), booleans, numbers, arrays
 * and inline tables. Anything else throws with a line number instead of
 * being guessed at — a mis-read registry would make the guard lie.
 */

const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(text, label = "TOML") {
  return new Parser(text, label).parseDocument();
}

class Parser {
  constructor(text, label) {
    this.s = text;
    this.i = 0;
    this.label = label;
    this.root = {};
    this.current = this.root;
  }

  fail(message) {
    const line = this.s.slice(0, this.i).split("\n").length;
    throw new Error(`${this.label}:${line}: ${message}`);
  }

  peek(offset = 0) {
    return this.s[this.i + offset];
  }

  skipBlanks(newlines) {
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c === " " || c === "\t") this.i++;
      else if (newlines && (c === "\n" || c === "\r")) this.i++;
      else if (c === "#") {
        while (this.i < this.s.length && this.peek() !== "\n") this.i++;
      } else break;
    }
  }

  expectLineEnd() {
    this.skipBlanks(false);
    if (this.i < this.s.length && this.peek() !== "\n" && this.peek() !== "\r") {
      this.fail(`unexpected text ${JSON.stringify(this.peek())} after value`);
    }
  }

  parseDocument() {
    for (;;) {
      this.skipBlanks(true);
      if (this.i >= this.s.length) return this.root;
      if (this.peek() === "[") this.parseHeader();
      else this.parseAssignment(this.current);
      this.expectLineEnd();
    }
  }

  parseHeader() {
    const isArray = this.peek(1) === "[";
    this.i += isArray ? 2 : 1;
    const keys = this.parseKeyPath();
    for (const closer of isArray ? "]]" : "]") {
      if (this.peek() !== closer) this.fail(`expected "${closer}" in table header`);
      this.i++;
    }
    let node = this.root;
    for (const key of keys.slice(0, -1)) node = descend(node, key);
    const last = keys[keys.length - 1];
    if (isArray) {
      if (node[last] === undefined) node[last] = [];
      if (!Array.isArray(node[last])) this.fail(`"${last}" is not an array of tables`);
      const table = {};
      node[last].push(table);
      this.current = table;
    } else {
      if (node[last] === undefined) node[last] = {};
      if (Array.isArray(node[last])) this.fail(`"${last}" is an array of tables, not a table`);
      this.current = node[last];
    }
  }

  parseAssignment(target) {
    const keys = this.parseKeyPath();
    if (this.peek() !== "=") this.fail('expected "=" after key');
    this.i++;
    this.skipBlanks(false);
    const value = this.parseValue();
    let node = target;
    for (const key of keys.slice(0, -1)) {
      if (node[key] === undefined) node[key] = {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = value;
  }

  parseKeyPath() {
    const keys = [];
    for (;;) {
      this.skipBlanks(false);
      const c = this.peek();
      if (c === '"') keys.push(this.parseBasicString());
      else if (c === "'") keys.push(this.parseLiteralString());
      else {
        const start = this.i;
        while (this.i < this.s.length && BARE_KEY.test(this.peek())) this.i++;
        if (this.i === start) this.fail("expected a key");
        keys.push(this.s.slice(start, this.i));
      }
      this.skipBlanks(false);
      if (this.peek() === ".") {
        this.i++;
        continue;
      }
      return keys;
    }
  }

  parseValue() {
    const c = this.peek();
    if (c === '"') {
      return this.s.startsWith('"""', this.i) ? this.parseMultilineBasic() : this.parseBasicString();
    }
    if (c === "'") {
      return this.s.startsWith("'''", this.i) ? this.parseMultilineLiteral() : this.parseLiteralString();
    }
    if (c === "[") return this.parseArray();
    if (c === "{") return this.parseInlineTable();
    const token = this.readScalarToken();
    if (token === "true") return true;
    if (token === "false") return false;
    if (/^[+-]?(0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d+)?|inf|nan)$/.test(token)) {
      const cleaned = token.replace(/_/g, "");
      if (/^[+-]?0[xob]/.test(cleaned)) return Number(cleaned.replace(/^([+-]?)0([xob])/, "$10$2"));
      return Number(cleaned);
    }
    // Dates and times are kept verbatim; nothing here needs them.
    if (/^\d{4}-\d{2}-\d{2}/.test(token) || /^\d{2}:\d{2}:\d{2}/.test(token)) return token;
    this.fail(`unsupported value ${JSON.stringify(token)}`);
  }

  readScalarToken() {
    const start = this.i;
    while (this.i < this.s.length && !/[\s,\]}#]/.test(this.peek())) this.i++;
    if (this.i === start) this.fail("expected a value");
    let token = this.s.slice(start, this.i);
    // A local date-time may contain one space between date and time.
    if (/^\d{4}-\d{2}-\d{2}$/.test(token) && this.peek() === " " && /\d/.test(this.peek(1) ?? "")) {
      this.i++;
      const restStart = this.i;
      while (this.i < this.s.length && !/[\s,\]}#]/.test(this.peek())) this.i++;
      token += ` ${this.s.slice(restStart, this.i)}`;
    }
    return token;
  }

  parseArray() {
    this.i++;
    const items = [];
    for (;;) {
      this.skipBlanks(true);
      if (this.i >= this.s.length) this.fail("unterminated array");
      if (this.peek() === "]") {
        this.i++;
        return items;
      }
      items.push(this.parseValue());
      this.skipBlanks(true);
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "]") this.fail('expected "," or "]" in array');
    }
  }

  parseInlineTable() {
    this.i++;
    const table = {};
    this.skipBlanks(false);
    if (this.peek() === "}") {
      this.i++;
      return table;
    }
    for (;;) {
      this.parseAssignment(table);
      this.skipBlanks(false);
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      if (this.peek() === "}") {
        this.i++;
        return table;
      }
      this.fail('expected "," or "}" in inline table');
    }
  }

  parseBasicString() {
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length || this.peek() === "\n") this.fail("unterminated string");
      const c = this.peek();
      if (c === '"') {
        this.i++;
        return out;
      }
      if (c === "\\") out += this.parseEscape();
      else {
        out += c;
        this.i++;
      }
    }
  }

  parseMultilineBasic() {
    this.i += 3;
    if (this.peek() === "\n") this.i++;
    else if (this.peek() === "\r" && this.peek(1) === "\n") this.i += 2;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail("unterminated multi-line string");
      if (this.s.startsWith('"""', this.i)) {
        this.i += 3;
        while (this.peek() === '"') {
          out += '"';
          this.i++;
        }
        return out;
      }
      const c = this.peek();
      if (c === "\\") {
        // A backslash at the end of a line trims the following whitespace.
        if (/^\\[ \t]*\r?\n/.test(this.s.slice(this.i, this.i + 8))) {
          this.i++;
          while (this.i < this.s.length && /\s/.test(this.peek())) this.i++;
          continue;
        }
        out += this.parseEscape();
      } else {
        out += c;
        this.i++;
      }
    }
  }

  parseEscape() {
    const c = this.peek(1);
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (c in simple) {
      this.i += 2;
      return simple[c];
    }
    if (c === "u" || c === "U") {
      const width = c === "u" ? 4 : 8;
      const hex = this.s.slice(this.i + 2, this.i + 2 + width);
      if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) this.fail("invalid unicode escape");
      this.i += 2 + width;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    this.fail(`invalid escape "\\${c ?? ""}"`);
  }

  parseLiteralString() {
    this.i++;
    const end = this.s.indexOf("'", this.i);
    const newline = this.s.indexOf("\n", this.i);
    if (end === -1 || (newline !== -1 && newline < end)) this.fail("unterminated literal string");
    const out = this.s.slice(this.i, end);
    this.i = end + 1;
    return out;
  }

  parseMultilineLiteral() {
    this.i += 3;
    if (this.peek() === "\n") this.i++;
    else if (this.peek() === "\r" && this.peek(1) === "\n") this.i += 2;
    const end = this.s.indexOf("'''", this.i);
    if (end === -1) this.fail("unterminated multi-line literal string");
    let stop = end;
    while (this.s[stop + 3] === "'" && stop - end < 2) stop++;
    const out = this.s.slice(this.i, stop);
    this.i = stop + 3;
    return out;
  }
}

/** `[a.b]` under an array of tables `a` addresses the last element of `a`. */
function descend(node, key) {
  if (node[key] === undefined) node[key] = {};
  const child = node[key];
  return Array.isArray(child) ? child[child.length - 1] : child;
}
