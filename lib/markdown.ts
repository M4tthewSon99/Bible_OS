/**
 * The small Markdown subset the note and devotion editors accept.
 * Input is escaped before any tag is emitted, so the result is safe to
 * inject with dangerouslySetInnerHTML.
 */
export function markdown(source: string): string {
  const escape = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const inline = (value: string) => escape(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = source.replace(/\r/g, "").split("\n");
  const output: string[] = [];
  const listMatch = (raw: string) => raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);

  /* Nested lists are common in study notes. Building the HTML recursively
     keeps children inside their parent <li> instead of flattening them into
     paragraphs, while every piece of user text still travels through inline(). */
  const renderList = (start: number, indent: number): [string, number] => {
    const first = listMatch(lines[start]);
    if (!first) return ["", start];
    const type = /^\d/.test(first[2]) ? "ol" : "ul";
    const items: string[] = [];
    let index = start;

    while (index < lines.length) {
      const match = listMatch(lines[index]);
      if (!match) break;
      const currentIndent = match[1].replace(/\t/g, "  ").length;
      const currentType = /^\d/.test(match[2]) ? "ol" : "ul";
      if (currentIndent !== indent || currentType !== type) break;

      const content = [match[3]];
      let children = "";
      index += 1;

      while (index < lines.length) {
        const next = listMatch(lines[index]);
        if (next) {
          const nextIndent = next[1].replace(/\t/g, "  ").length;
          if (nextIndent > indent) {
            const [child, nextIndex] = renderList(index, nextIndent);
            children += child;
            index = nextIndex;
            continue;
          }
          break;
        }
        if (!lines[index].trim()) break;
        content.push(lines[index].trim());
        index += 1;
      }

      items.push(`<li>${content.map(inline).join("<br>")}${children}</li>`);
      if (!lines[index]?.trim()) break;
    }

    return [`<${type}>${items.join("")}</${type}>`, index];
  };

  let index = 0;
  while (index < lines.length) {
    const raw = lines[index].trimEnd();
    if (!raw.trim()) {
      index += 1;
      continue;
    }
    const list = listMatch(raw);
    if (list) {
      const indent = list[1].replace(/\t/g, "  ").length;
      const [html, nextIndex] = renderList(index, indent);
      output.push(html);
      index = nextIndex;
      continue;
    }
    const heading = raw.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }
    const quote = raw.match(/^>\s?(.*)$/);
    if (quote) {
      output.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      index += 1;
      continue;
    }
    output.push(`<p>${inline(raw)}</p>`);
    index += 1;
  }
  return output.join("");
}
