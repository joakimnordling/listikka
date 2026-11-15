// Names as typed are kept; these helpers only compare them.
// Unicode NFC, invisible characters removed, runs of spaces collapsed, so look-alike names count as the same.
export const normName = (s) =>
  String(s || "")
    .normalize("NFC")
    .replace(/[​-‏⁠-⁤﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// The key used when matching names, such as for suggestions. Not part of any ID, so it can be improved later.
export const matchKey = (s) => normName(s).toLowerCase();

export const sameName = (a, b) => matchKey(a) === matchKey(b);
