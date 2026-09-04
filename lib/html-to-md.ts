/** DOM -> markdown, the exact inverse of lib/md.ts's renderMarkdown.
 *
 *  The article reviewer lets people edit the rendered page directly (contentEditable) instead
 *  of typing markdown — see components/dashboard/ArticleApprovalSection.tsx. Articles are still
 *  STORED as markdown (that's what the publisher, the SEO checks and every agent read), so what
 *  the browser produced has to come back as markdown before it's saved.
 *
 *  It only understands the vocabulary renderMarkdown emits (h1-h6, p, ul/ol, blockquote,
 *  pre/code, hr, strong/em/code/a) plus the tags a browser inserts while editing (b, i, div,
 *  br, span, font). Anything else is flattened to its text, which is the safe direction: a
 *  stray tag becomes plain prose, never markup smuggled into the draft.
 */

const BLOCK = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "DIV", "SECTION", "ARTICLE"]);

/** Markdown's own control characters, escaped so edited prose round-trips as prose. */
function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}

function inlineOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(inlineOf).join("");
  switch (el.tagName) {
    case "BR": return "\n";
    case "STRONG": case "B": return inner.trim() ? `**${inner.trim()}**` : "";
    case "EM": case "I": return inner.trim() ? `*${inner.trim()}*` : "";
    case "CODE": return inner.trim() ? `\`${inner.replace(/\\([\\`*_[\]])/g, "$1").trim()}\`` : "";
    case "A": {
      const href = el.getAttribute("href") ?? "";
      // Same allow-list renderMarkdown links with: http(s) or a site-relative path.
      const safe = /^(https?:\/\/|\/)/.test(href) ? href : "";
      return safe && inner.trim() ? `[${inner.trim()}](${safe})` : inner;
    }
    default: return inner;
  }
}

/** Collapse the whitespace a browser leaves behind, but keep hard line breaks (from <br>). */
const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();

function blockOf(el: HTMLElement, out: string[]): void {
  switch (el.tagName) {
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
      const text = tidy(inlineOf(el));
      if (text) out.push(`${"#".repeat(Number(el.tagName[1]))} ${text.replace(/\n/g, " ")}`);
      return;
    }
    case "UL": case "OL": {
      const ordered = el.tagName === "OL";
      const items = Array.from(el.children)
        .filter((c) => c.tagName === "LI")
        .map((li, i) => {
          const text = tidy(inlineOf(li)).replace(/\n/g, " ");
          return text ? `${ordered ? `${i + 1}.` : "-"} ${text}` : "";
        })
        .filter(Boolean);
      if (items.length) out.push(items.join("\n"));
      return;
    }
    case "BLOCKQUOTE": {
      const text = tidy(inlineOf(el));
      if (text) out.push(text.split("\n").map((l) => `> ${l}`).join("\n"));
      return;
    }
    case "PRE": {
      const text = (el.textContent ?? "").replace(/\s+$/, "");
      if (text) out.push("```\n" + text + "\n```");
      return;
    }
    case "HR": out.push("---"); return;
    default: {
      // A <div> the browser made while editing can hold blocks of its own — recurse rather
      // than flattening a whole section into one paragraph.
      if (Array.from(el.children).some((c) => BLOCK.has(c.tagName))) {
        Array.from(el.childNodes).forEach((n) => walk(n, out));
        return;
      }
      const text = tidy(inlineOf(el));
      if (text) out.push(text);
    }
  }
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = tidy(escapeText(node.nodeValue ?? ""));
    if (text) out.push(text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  blockOf(node as HTMLElement, out);
}

export function htmlToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  Array.from(root.childNodes).forEach((n) => walk(n, out));
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
