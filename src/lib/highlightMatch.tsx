import React from "react";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightMatch(
  text: string,
  query: string,
): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        className="bg-warning/20 text-inherit rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
