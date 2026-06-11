// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromBase64 } from "./bridge/BridgeExtensionLoader";

/** Bridge event name the ext_visualizer host uses to stream "open with" files. */
export const OPEN_FILE_CHUNK_EVENT = "open-file-chunk";

export type OpenFileChunk = {
  name: string;
  chunkIndex: number;
  totalChunks: number;
  dataB64: string;
};

/** Validate an `open-file-chunk` event payload; returns undefined for malformed payloads. */
export function parseOpenFileChunk(payload: unknown): OpenFileChunk | undefined {
  if (typeof payload !== "object" || payload == undefined) {
    return undefined;
  }
  const { name, chunkIndex, totalChunks, dataB64 } = payload as Partial<OpenFileChunk>;
  if (typeof name !== "string" || name.length === 0 || typeof dataB64 !== "string") {
    return undefined;
  }
  if (
    typeof chunkIndex !== "number" ||
    typeof totalChunks !== "number" ||
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(totalChunks)
  ) {
    return undefined;
  }
  if (totalChunks < 1 || chunkIndex < 0 || chunkIndex >= totalChunks) {
    return undefined;
  }
  return { name, chunkIndex, totalChunks, dataB64 };
}

type InProgressFile = {
  totalChunks: number;
  chunks: (string | undefined)[];
  received: number;
};

/**
 * Reassembles base64-chunked files streamed over the bridge into File objects.
 *
 * Pure logic (no DOM): feed each `open-file-chunk` payload to {@link add}; it returns the
 * completed File when the final chunk of a name arrives, undefined otherwise.
 *
 * Note: the whole file is buffered in memory (base64 strings + decoded bytes), so this path
 * is only suitable for files that comfortably fit in the webview heap.
 */
export class OpenFileChunkAssembler {
  #inProgress = new Map<string, InProgressFile>();

  public add(payload: unknown): File | undefined {
    const chunk = parseOpenFileChunk(payload);
    if (!chunk) {
      console.warn("[open-file] ignoring malformed open-file-chunk payload", payload);
      return undefined;
    }
    const { name, chunkIndex, totalChunks, dataB64 } = chunk;

    let entry = this.#inProgress.get(name);
    if (entry && entry.totalChunks !== totalChunks) {
      if (chunkIndex === 0) {
        // The host restarted the stream for this name (e.g. the file changed or the previous
        // transfer was abandoned); drop the stale partial transfer and start over.
        console.debug(
          `[open-file] restarting interrupted transfer of "${name}" ` +
            `(${entry.totalChunks} -> ${totalChunks} chunks)`,
        );
        entry = undefined;
      } else {
        console.warn(
          `[open-file] dropping chunk ${chunkIndex} of "${name}": totalChunks mismatch ` +
            `(have ${entry.totalChunks}, got ${totalChunks})`,
        );
        return undefined;
      }
    }
    if (!entry) {
      entry = {
        totalChunks,
        chunks: new Array<string | undefined>(totalChunks).fill(undefined),
        received: 0,
      };
      this.#inProgress.set(name, entry);
    }

    if (entry.chunks[chunkIndex] == undefined) {
      entry.received += 1;
    }
    entry.chunks[chunkIndex] = dataB64;

    if (entry.received < entry.totalChunks) {
      return undefined;
    }
    this.#inProgress.delete(name);
    const parts = entry.chunks.map((part) => fromBase64(part ?? ""));
    return new File(parts, name);
  }
}

/**
 * The hidden file input DocumentDropListener exposes for Puppeteer
 * (packages/suite-base/src/components/DocumentDropListener.tsx).
 *
 * Why this input instead of a synthetic drop event: DocumentDropListener attaches its drop
 * handler to `document`, but that handler only collects files whose DataTransfer item passes
 * `webkitGetAsEntry()?.isFile` (or yields a FileSystemFileHandle). In Chromium both APIs come
 * up empty for a script-constructed DataTransfer — entries/handles are only backed by real OS
 * drags — so a synthetic DragEvent dead-ends before reaching the onDrop callback. The hidden
 * input's change handler reads `event.target.files` directly and routes into the exact same
 * `onDrop({ files, namespace: "local" })` flow (Workspace.tsx dropHandler -> handleFiles),
 * with no DataTransfer/entries assumptions.
 */
export const OPEN_FILE_INPUT_SELECTOR = "input[data-puppeteer-file-upload]";

/**
 * Hand a File to the app through the hidden drop input. Returns false when the input is not
 * mounted yet (app shell still loading) so the caller can retry.
 */
export function injectFileIntoApp(file: File): boolean {
  const input = document.querySelector<HTMLInputElement>(OPEN_FILE_INPUT_SELECTOR);
  if (!input) {
    return false;
  }
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
  } catch {
    // jsdom (tests) does not implement the DataTransfer constructor; fall back to defining the
    // property directly. React only reads `event.target.files`, so an array suffices there.
    Object.defineProperty(input, "files", { value: [file], configurable: true });
  }
  // React delegates onChange to the native "change" event at the root container, so the event
  // must bubble to be picked up.
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
