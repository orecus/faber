import { open } from "@tauri-apps/plugin-dialog";

/**
 * Opens the OS-native folder picker and returns the selected path,
 * or `null` if the user cancelled.
 */
export async function pickProjectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select a project folder",
  });
  return selected;
}
