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
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };

  source.replace(/\r/g, "").split("\n").forEach((raw) => {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      return;
    }
    let match = line.match(/^(#{1,3})\s+(.*)$/);
    if (match) {
      closeList();
      output.push(`<h${match[1].length}>${inline(match[2])}</h${match[1].length}>`);
      return;
    }
    match = line.match(/^>\s?(.*)$/);
    if (match) {
      closeList();
      output.push(`<blockquote>${inline(match[1])}</blockquote>`);
      return;
    }
    match = line.match(/^[-*+]\s+(.*)$/);
    if (match) {
      if (list !== "ul") {
        closeList();
        output.push("<ul>");
        list = "ul";
      }
      output.push(`<li>${inline(match[1])}</li>`);
      return;
    }
    match = line.match(/^\d+[.)]\s+(.*)$/);
    if (match) {
      if (list !== "ol") {
        closeList();
        output.push("<ol>");
        list = "ol";
      }
      output.push(`<li>${inline(match[1])}</li>`);
      return;
    }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  });
  closeList();
  return output.join("");
}
