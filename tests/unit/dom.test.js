import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { html, raw } from "../../src/ui/dom.js";

const s = (m) => String(m);

describe("html``", () => {
  it("puts values in as text, escaped", () => {
    const name = `<img src=x onerror="alert('x')"> & co`;
    assert.equal(s(html`<b>${name}</b>`), "<b>&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; co</b>");
    assert.equal(
      s(html`<input value="${'" autofocus onfocus="x'}">`),
      '<input value="&quot; autofocus onfocus=&quot;x">',
    );
  });

  it("keeps markup from html`` and raw() as it is, and joins arrays", () => {
    const rows = ["Milk", "<Eggs>"].map((n) => html`<li>${n}</li>`);
    assert.equal(s(html`<ul>${rows}</ul>`), "<ul><li>Milk</li><li>&lt;Eggs&gt;</li></ul>");
    assert.equal(s(html`<p>${raw("<svg></svg>")}</p>`), "<p><svg></svg></p>");
  });

  it("leaves nothing for null, undefined and false, and puts numbers in", () => {
    assert.equal(s(html`<p>${null}${undefined}${false}${0}${2}</p>`), "<p>02</p>");
  });

  it("escapes a string that only looks like markup, such as an html`` result turned into text", () => {
    const text = `${html`<b>x</b>`}`;
    assert.equal(s(html`<p>${text}</p>`), "<p>&lt;b&gt;x&lt;/b&gt;</p>");
  });
});
