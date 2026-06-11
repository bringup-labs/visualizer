/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  OPEN_FILE_INPUT_SELECTOR,
  OpenFileChunk,
  OpenFileChunkAssembler,
  injectFileIntoApp,
  parseOpenFileChunk,
} from "./openFileChunks";

function chunk(
  name: string,
  chunkIndex: number,
  totalChunks: number,
  content: string,
): OpenFileChunk {
  return { name, chunkIndex, totalChunks, dataB64: btoa(content) };
}

// jsdom's File does not implement Blob#text(); read through FileReader instead.
async function fileText(file: File | undefined): Promise<string | undefined> {
  if (!file) {
    return undefined;
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("FileReader failed"));
    };
    reader.readAsText(file);
  });
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("parseOpenFileChunk", () => {
  it("accepts a well-formed payload", () => {
    expect(parseOpenFileChunk(chunk("a.mcap", 0, 2, "x"))).toEqual(chunk("a.mcap", 0, 2, "x"));
  });

  it.each([
    ["undefined", undefined],
    ["a string", "nope"],
    ["missing name", { chunkIndex: 0, totalChunks: 1, dataB64: "" }],
    ["empty name", { name: "", chunkIndex: 0, totalChunks: 1, dataB64: "" }],
    ["missing dataB64", { name: "a", chunkIndex: 0, totalChunks: 1 }],
    ["non-integer chunkIndex", { name: "a", chunkIndex: 0.5, totalChunks: 1, dataB64: "" }],
    ["negative chunkIndex", { name: "a", chunkIndex: -1, totalChunks: 1, dataB64: "" }],
    ["zero totalChunks", { name: "a", chunkIndex: 0, totalChunks: 0, dataB64: "" }],
    ["chunkIndex out of range", { name: "a", chunkIndex: 2, totalChunks: 2, dataB64: "" }],
  ])("rejects %s", (_label, payload) => {
    expect(parseOpenFileChunk(payload)).toBeUndefined();
  });
});

describe("OpenFileChunkAssembler", () => {
  it("returns undefined until the final chunk, then a File with the full content", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 0, 3, "foo"))).toBeUndefined();
    expect(assembler.add(chunk("a.mcap", 1, 3, "bar"))).toBeUndefined();
    const file = assembler.add(chunk("a.mcap", 2, 3, "baz"));
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe("a.mcap");
    expect(file?.size).toBe(9);
    expect(await fileText(file)).toBe("foobarbaz");
  });

  it("assembles out-of-order chunks in index order", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 1, 3, "bar"))).toBeUndefined();
    expect(assembler.add(chunk("a.mcap", 2, 3, "baz"))).toBeUndefined();
    const file = assembler.add(chunk("a.mcap", 0, 3, "foo"));
    expect(await fileText(file)).toBe("foobarbaz");
  });

  it("tracks interleaved transfers of different names independently", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 0, 2, "a0"))).toBeUndefined();
    expect(assembler.add(chunk("b.bag", 0, 2, "b0"))).toBeUndefined();
    const fileA = assembler.add(chunk("a.mcap", 1, 2, "a1"));
    expect(await fileText(fileA)).toBe("a0a1");
    const fileB = assembler.add(chunk("b.bag", 1, 2, "b1"));
    expect(await fileText(fileB)).toBe("b0b1");
  });

  it("restarts when chunk 0 arrives for an in-progress name with a different totalChunks", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 0, 3, "old0"))).toBeUndefined();
    expect(assembler.add(chunk("a.mcap", 1, 3, "old1"))).toBeUndefined();
    // New stream for the same name with a different chunk count: discard the old transfer.
    expect(assembler.add(chunk("a.mcap", 0, 2, "new0"))).toBeUndefined();
    const file = assembler.add(chunk("a.mcap", 1, 2, "new1"));
    expect(await fileText(file)).toBe("new0new1");
  });

  it("drops non-initial chunks whose totalChunks does not match the in-progress transfer", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 0, 2, "a0"))).toBeUndefined();
    // Stray chunk from a differently-sized stream: ignored, current transfer unaffected.
    expect(assembler.add(chunk("a.mcap", 2, 5, "stray"))).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
    const file = assembler.add(chunk("a.mcap", 1, 2, "a1"));
    expect(await fileText(file)).toBe("a0a1");
  });

  it("does not complete early on duplicate chunks", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add(chunk("a.mcap", 0, 2, "a0"))).toBeUndefined();
    expect(assembler.add(chunk("a.mcap", 0, 2, "a0"))).toBeUndefined();
    const file = assembler.add(chunk("a.mcap", 1, 2, "a1"));
    expect(await fileText(file)).toBe("a0a1");
  });

  it("allows the same name to be streamed again after completion", async () => {
    const assembler = new OpenFileChunkAssembler();
    expect(await fileText(assembler.add(chunk("a.mcap", 0, 1, "first")))).toBe("first");
    expect(await fileText(assembler.add(chunk("a.mcap", 0, 1, "second")))).toBe("second");
  });

  it("ignores malformed payloads with a warning", () => {
    const assembler = new OpenFileChunkAssembler();
    expect(assembler.add({ nope: true })).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("evicts abandoned partial transfers after 60s and allows the name to restart clean", async () => {
    jest.useFakeTimers();
    try {
      const assembler = new OpenFileChunkAssembler();

      // Start stream A (2 chunks) — do NOT finish it.
      expect(assembler.add(chunk("a.mcap", 0, 2, "a0"))).toBeUndefined();

      // Advance time past the 60 s eviction threshold.
      jest.advanceTimersByTime(61_000);

      // Any new add() triggers the eviction sweep.  Use a single-chunk stream B so it
      // completes immediately and we can verify it is unaffected.
      const fileB = assembler.add(chunk("b.bag", 0, 1, "b0"));
      expect(fileB).toBeInstanceOf(File);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('evicting abandoned partial transfer of "a.mcap"'),
      );

      // The stale A entry is gone: sending the missing chunk 1 with the old totalChunks=2
      // creates a fresh entry (chunk 0 is still missing → returns undefined).
      expect(assembler.add(chunk("a.mcap", 1, 2, "a1"))).toBeUndefined();

      // A fresh single-chunk stream for A now completes immediately.
      expect(assembler.add(chunk("a.mcap", 0, 1, "fresh"))).toBeInstanceOf(File);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("injectFileIntoApp", () => {
  it("returns false when the hidden drop input is not mounted", () => {
    expect(injectFileIntoApp(new File(["x"], "a.mcap"))).toBe(false);
  });

  it("sets the input files and dispatches a bubbling change event", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("data-puppeteer-file-upload", "true");
    document.body.appendChild(input);

    const changeEvents: Event[] = [];
    // Listen on document to verify the event bubbles (React delegates at the root).
    document.addEventListener("change", (ev) => changeEvents.push(ev));

    const file = new File(["hello"], "a.mcap");
    expect(injectFileIntoApp(file)).toBe(true);

    expect(changeEvents).toHaveLength(1);
    expect(changeEvents[0]?.target).toBe(input);
    const selected = document.querySelector<HTMLInputElement>(OPEN_FILE_INPUT_SELECTOR);
    expect(Array.from(selected?.files ?? [])).toEqual([file]);
  });
});
