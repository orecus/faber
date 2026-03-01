import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TaskMarkdownPreviewProps {
  body: string;
}

export default function TaskMarkdownPreview({ body }: TaskMarkdownPreviewProps) {
  if (!body.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No content yet. Switch to edit mode to add a description.
      </div>
    );
  }

  return (
    <div className="markdown-preview flex-1 overflow-y-auto px-1">
      <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
    </div>
  );
}
