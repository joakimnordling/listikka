// Saving a file: the share sheet where it can take files (on iPhone, Save to Files), otherwise a download.
// Reading one back: the bytes of a chosen file as text, unpacking a .zip. From Lokki's src/ui/files.js and backup.js.
import { unzipFirst } from "../core/zip.js";

const MIME = { zip: "application/zip", jsonl: "application/jsonl", txt: "text/plain" };

/** Returns true when saved or shared, false when the share sheet was closed. Throws when neither works. */
export async function saveFile(filename, data) {
  const file = new File([data], filename, { type: MIME[filename.split(".").pop()] || "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return false; // closed the share sheet
      // NotAllowedError: the tap was too long ago (compressing takes a moment); download instead
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/** A file's text; a .zip is unpacked first. Throws when it can't be read. */
export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip && typeof DecompressionStream !== "function") throw new Error("no-unzip");
  return new TextDecoder().decode(zip ? await unzipFirst(bytes) : bytes);
}

/** Local date and time for file names: 2026-11-15-1159. */
export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
