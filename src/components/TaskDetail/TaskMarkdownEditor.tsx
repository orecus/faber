import { Textarea } from "../ui/textarea";

interface TaskMarkdownEditorProps {
  body: string;
  onChange: (body: string) => void;
}

const PLACEHOLDER = `## Objective

Describe what this task should accomplish.

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion

## Implementation Plan

1. Step one
2. Step two
`;

export default function TaskMarkdownEditor({ body, onChange }: TaskMarkdownEditorProps) {
  return (
    <Textarea
      value={body}
      onChange={(e) => onChange(e.target.value)}
      placeholder={PLACEHOLDER}
      className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed [field-sizing:fixed]"
    />
  );
}
