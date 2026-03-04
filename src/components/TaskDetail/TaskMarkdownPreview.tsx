import { Streamdown } from "streamdown";

import {
  streamdownControls,
  streamdownPlugins,
  streamdownTheme,
} from "../../lib/markdown";

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
      <Streamdown mode="static" plugins={streamdownPlugins} shikiTheme={streamdownTheme} controls={streamdownControls}>{body}</Streamdown>
    </div>
  );
}
