import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

// Module-level cache: project id → raw SVG markup or null
const iconCache = new Map<string, string | null>();

/**
 * Resolves a project icon (SVG) — first checks manual `icon_path`,
 * then falls back to auto-detection via `resolve_project_icon`.
 * Returns raw SVG markup string or null.
 *
 * The SVG is sanitized to use `currentColor` for fills/strokes so it
 * inherits the current text color from the theme.
 */
export function useProjectIcon(
  projectId: string,
  projectPath: string,
  manualIconPath: string | null,
): string | null {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(() => iconCache.get(projectId) ?? null);

  useEffect(() => {
    // If already cached, use it
    if (iconCache.has(projectId)) {
      setSvgMarkup(iconCache.get(projectId) ?? null);
      return;
    }

    let cancelled = false;

    async function resolve() {
      try {
        let svgPath: string | null = null;

        if (manualIconPath) {
          // Use the manually set icon path
          svgPath = manualIconPath;
        } else {
          // Auto-detect
          svgPath = await invoke<string | null>("resolve_project_icon", { path: projectPath });
        }

        if (cancelled) return;

        if (!svgPath) {
          iconCache.set(projectId, null);
          setSvgMarkup(null);
          return;
        }

        // Read the SVG content
        const content = await invoke<string | null>("read_svg_icon", { path: svgPath });
        if (cancelled) return;

        if (content) {
          // Sanitize SVG to prevent XSS (strip scripts, event handlers, etc.)
          // then normalize colors for theme compatibility.
          const sanitized = DOMPurify.sanitize(content, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["script", "foreignObject"],
            FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover", "onmouseout", "onfocus", "onblur"],
          });
          const normalized = normalizeSvgForTheme(sanitized);
          iconCache.set(projectId, normalized);
          setSvgMarkup(normalized);
        } else {
          iconCache.set(projectId, null);
          setSvgMarkup(null);
        }
      } catch {
        if (!cancelled) {
          iconCache.set(projectId, null);
          setSvgMarkup(null);
        }
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [projectId, projectPath, manualIconPath]);

  return svgMarkup;
}

/**
 * Normalize an SVG string so it adapts to the current theme:
 * - Replaces hardcoded fill/stroke colors with `currentColor`
 * - Removes width/height attributes (let CSS control sizing)
 * - Ensures viewBox is preserved for proper scaling
 */
function normalizeSvgForTheme(svg: string): string {
  let result = svg;

  // Remove width/height from the root <svg> tag so CSS controls size
  result = result.replace(
    /(<svg[^>]*?)\s+(width|height)=["'][^"']*["']/gi,
    "$1",
  );
  // Do a second pass in case both were present
  result = result.replace(
    /(<svg[^>]*?)\s+(width|height)=["'][^"']*["']/gi,
    "$1",
  );

  // Replace hardcoded color fills/strokes with currentColor.
  // Match hex colors (#xxx, #xxxxxx), rgb(), named colors like "black", "white", etc.
  // but preserve "none" and "transparent".
  const colorPattern = /(fill|stroke)=["'](#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|black|white|red|green|blue|gray|grey)["']/gi;
  result = result.replace(colorPattern, '$1="currentColor"');

  return result;
}


/** Clear the icon cache for a specific project (e.g. after setting a custom icon). */
export function clearIconCache(projectId: string) {
  iconCache.delete(projectId);
}
