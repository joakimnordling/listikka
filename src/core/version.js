// Which build this is. The build replaces __LISTIKKA_BUILD__ (scripts/build-info.js); outside a build there is none.
export const REPO = "https://github.com/joakimnordling/listikka";
/* global __LISTIKKA_BUILD__ */
export const BUILD =
  typeof __LISTIKKA_BUILD__ === "object" ? __LISTIKKA_BUILD__ : { version: "development", commit: "", built: "" };
/** A link to exactly this build's source: its commit, or the repository when unknown. */
export const sourceUrl = () => (BUILD.commit ? `${REPO}/tree/${BUILD.commit}` : REPO);
