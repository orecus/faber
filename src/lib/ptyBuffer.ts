/**
 * Global PTY output buffer.
 *
 * Captures all pty-output events into per-session ring buffers so that
 * terminal content can be replayed when a Terminal component remounts
 * (e.g., after a project switch).
 */
import { listen } from "@tauri-apps/api/event";

interface PtyOutputPayload {
  session_id: string;
  data: string;
}

/** Maximum buffer size per session (chars). */
const MAX_BUFFER_SIZE = 512 * 1024;

class PtyOutputBuffer {
  private buffers = new Map<string, string[]>();
  private sizes = new Map<string, number>();
  private initialized = false;

  /** Start the global pty-output listener. Call once at app startup. */
  async init() {
    if (this.initialized) return;
    this.initialized = true;

    await listen<PtyOutputPayload>("pty-output", (event) => {
      this.append(event.payload.session_id, event.payload.data);
    });
  }

  private append(sessionId: string, data: string) {
    let chunks = this.buffers.get(sessionId);
    if (!chunks) {
      chunks = [];
      this.buffers.set(sessionId, chunks);
      this.sizes.set(sessionId, 0);
    }

    chunks.push(data);
    let size = (this.sizes.get(sessionId) ?? 0) + data.length;

    // Trim oldest chunks when over limit
    while (size > MAX_BUFFER_SIZE && chunks.length > 1) {
      size -= chunks.shift()!.length;
    }
    this.sizes.set(sessionId, size);
  }

  /** Get all buffered output for a session. */
  getBuffer(sessionId: string): string {
    const chunks = this.buffers.get(sessionId);
    if (!chunks || chunks.length === 0) return "";
    return chunks.join("");
  }

  /** Remove buffer for a session. */
  clear(sessionId: string) {
    this.buffers.delete(sessionId);
    this.sizes.delete(sessionId);
  }
}

export const ptyBuffer = new PtyOutputBuffer();
