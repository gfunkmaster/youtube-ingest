import { join, resolve } from "node:path";

/** Default subfolder for video sources, relative to the vault root. */
export const VIDEO_NOTES_SUBDIR = "01-Raw/Videos";

export function videoNotesDir(vaultDir: string, subdir = VIDEO_NOTES_SUBDIR): string {
  return resolve(vaultDir, subdir);
}

export function noteFilePath(
  vaultDir: string,
  fileName: string,
  subdir = VIDEO_NOTES_SUBDIR,
): string {
  return join(videoNotesDir(vaultDir, subdir), fileName);
}
