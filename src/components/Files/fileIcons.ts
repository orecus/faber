import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  FileType,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  // Code
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  rs: FileCode,
  py: FileCode,
  go: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  rb: FileCode,
  php: FileCode,
  swift: FileCode,
  kt: FileCode,
  scala: FileCode,
  vue: FileCode,
  svelte: FileCode,
  // Data / Config
  json: FileJson,
  yaml: FileJson,
  yml: FileJson,
  toml: FileJson,
  xml: FileJson,
  // Text / Docs
  md: FileText,
  mdx: FileText,
  txt: FileText,
  rtf: FileText,
  doc: FileText,
  docx: FileText,
  pdf: FileText,
  // Styles
  css: FileType,
  scss: FileType,
  less: FileType,
  sass: FileType,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  ico: FileImage,
  webp: FileImage,
  bmp: FileImage,
  // Video
  mp4: FileVideo,
  webm: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  // Audio
  mp3: FileAudio,
  wav: FileAudio,
  ogg: FileAudio,
  flac: FileAudio,
  // Archive
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
  // Spreadsheet
  csv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
};

export function getFileIcon(extension: string | null): LucideIcon {
  if (!extension) return File;
  return EXTENSION_ICONS[extension.toLowerCase()] ?? File;
}
