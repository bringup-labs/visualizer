/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, createElement } from "react";
import { createRoot, Root } from "react-dom/client";

import { OpenFileListener } from "./OpenFileListener";
import { BridgeClient } from "./bridge/BridgeClient";
import { OPEN_FILE_CHUNK_EVENT } from "./openFileChunks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EventCallback = (payload: unknown) => void;

function makeFakeBridge(): {
  bridge: Pick<BridgeClient, "onEvent">;
  emit: (event: string, payload: unknown) => void;
  unsubscribe: jest.Mock;
} {
  const listeners = new Map<string, EventCallback>();
  const unsubscribe = jest.fn();
  return {
    bridge: {
      onEvent: (event: string, cb: EventCallback) => {
        listeners.set(event, cb);
        return unsubscribe;
      },
    },
    emit: (event: string, payload: unknown) => {
      listeners.get(event)?.(payload);
    },
    unsubscribe,
  };
}

function fileChunk(name: string, chunkIndex: number, totalChunks: number, content: string) {
  return { name, chunkIndex, totalChunks, dataB64: btoa(content) };
}

// jsdom's File does not implement Blob#text(); read through FileReader instead.
async function readFileText(file: File | undefined): Promise<string | undefined> {
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

describe("<OpenFileListener>", () => {
  let wrapper: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "debug").mockImplementation(() => {});
    wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    root = createRoot(wrapper);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    wrapper.remove();
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("renders nothing", () => {
    const { bridge } = makeFakeBridge();
    act(() => {
      root.render(createElement(OpenFileListener, { bridge }));
    });
    expect(wrapper.innerHTML).toBe("");
  });

  it("assembles streamed chunks and injects exactly one File via the hidden drop input", async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("data-puppeteer-file-upload", "true");
    document.body.appendChild(input);

    const injections: File[][] = [];
    input.addEventListener("change", () => {
      injections.push(Array.from(input.files ?? []));
    });

    const { bridge, emit } = makeFakeBridge();
    act(() => {
      root.render(createElement(OpenFileListener, { bridge }));
    });

    act(() => {
      emit(OPEN_FILE_CHUNK_EVENT, fileChunk("a.mcap", 0, 3, "foo"));
      emit(OPEN_FILE_CHUNK_EVENT, fileChunk("a.mcap", 1, 3, "bar"));
    });
    expect(injections).toHaveLength(0);

    act(() => {
      emit(OPEN_FILE_CHUNK_EVENT, fileChunk("a.mcap", 2, 3, "baz"));
    });

    expect(injections).toHaveLength(1);
    const [files] = injections;
    expect(files).toHaveLength(1);
    const file = files?.[0];
    expect(file?.name).toBe("a.mcap");
    expect(file?.size).toBe(9);
    expect(await readFileText(file)).toBe("foobarbaz");
  });

  it("unsubscribes from the bridge on unmount", () => {
    const { bridge, unsubscribe } = makeFakeBridge();
    act(() => {
      root.render(createElement(OpenFileListener, { bridge }));
    });
    expect(unsubscribe).not.toHaveBeenCalled();
    act(() => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
