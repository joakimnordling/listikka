// Small DOM helpers, and html``: page markup where every ${value} is escaped unless it's markup itself.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Markup, as html`` and raw() make it; anything else put into html`` is text. */
class Markup {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

/** Trusted markup that isn't from html``, such as the icons' SVG. Never for anything a person typed. */
export const raw = (text) => new Markup(String(text));

const part = (v) =>
  v instanceof Markup ? v.text : Array.isArray(v) ? v.map(part).join("") : v == null || v === false ? "" : esc(v);

/**
 * Markup from a template: names, notes and every other ${value} come out as text, escaped, so nothing typed can
 * become markup. Values from html`` or raw() go in as they are, arrays are joined, and null, undefined and false
 * leave nothing. Assigning the result to innerHTML uses its text.
 */
export function html(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += part(values[i]) + strings[i + 1];
  return new Markup(text);
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
