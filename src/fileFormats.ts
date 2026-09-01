// Split out of DocumentViewer.tsx on purpose: App.tsx needs isTextLike
// synchronously (openFile), but DocumentViewer.tsx pulls in pdf.js/
// docx-preview/marked (heavy) — importing anything from that module
// statically, even just this function, pulled the whole thing into the
// main bundle regardless of DocumentViewer itself being lazy-loaded
// (Rolldown's INEFFECTIVE_DYNAMIC_IMPORT warning caught this live).
// This file has zero heavy dependencies, so it's safe to import from
// anywhere without defeating the code-split.
export function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

const TEXT_LIKE_EXTENSIONS = ["txt", "js", "ts", "tsx", "jsx", "py", "css", "html", "json"];
export function isTextLike(name: string): boolean {
  return TEXT_LIKE_EXTENSIONS.includes(extensionOf(name));
}
