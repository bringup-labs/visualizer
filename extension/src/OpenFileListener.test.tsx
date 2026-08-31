/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, createElement } from "react";
import { createRoot, Root } from "react-dom/client";

import { OpenFileListener } from "./OpenFileListener";
import { BridgeClient } from "./bridge/BridgeClient";
import { VIS_BRIDGE } from "./bridge/types";
import { OPEN_FILE_CHUNK_EVENT } from "./openFileChunks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EventCallback = (payload: unknown) => void;

function makeFakeBridge({ requestImpl }: { requestImpl?: jest.Mock } = {}): {
  bridge: Pick<BridgeClient, "onEvent" | "request">;
  emit: (event: string, payload: unknown) => void;
  unsubscribe: jest.Mock;
  request: jest.Mock;
  /** Whether the chunk listener was already subscribed when `request` ran. */
  subscribedAtRequest: () => boolean;
} {
  const listeners = new Map<string, EventCallback>();
  const unsubscribe = jest.fn();
  let subscribedWhenAsked = false;
  // The ordering is recorded around every implementation, custom ones included:
  // reading it off the default mock alone would silently report "not subscribed"
  // for any test that supplies its own `requestImpl`.
  const request = jest.fn(async (...args: unknown[]) => {
    subscribedWhenAsked = listeners.has(OPEN_FILE_CHUNK_EVENT);
    return await (requestImpl?.(...args) ?? {});
  });
  return {
    bridge: {
      onEvent: (event: string, cb: EventCallback) => {
        listeners.set(event, cb);
        return () => {
          // Actually detach, so a listener that outlives unmount is observable
          // through `emit` rather than only through the call count below.
          listeners.delete(event);
          unsubscribe();
        };
      },
      request,
    },
    emit: (event: string, payload: unknown) => {
      listeners.get(event)?.(payload);
    },
    unsubscribe,
    request,
    subscribedAtRequest: () => subscribedWhenAsked,
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

  it("asks the host for a pending file only after subscribing to chunks", () => {
    // Order is the whole point: the host drops chunks that arrive with no
    // subscriber, so asking before onEvent would reintroduce the race this
    // handshake exists to remove.
    const { bridge, request, subscribedAtRequest } = makeFakeBridge();
    act(() => {
      root.render(createElement(OpenFileListener, { bridge }));
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(VIS_BRIDGE.openFilePending, {});
    expect(subscribedAtRequest()).toBe(true);
  });

  it("keeps listening when the host does not know the handshake", async () => {
    // An older host rejects the unknown method; the listener must still be
    // usable, since a drag-and-drop open does not depend on the handshake.
    const rejecting = jest.fn(async () => {
      throw new Error("unknown method: openFile.pending");
    });
    const { bridge, emit } = makeFakeBridge({ requestImpl: rejecting });
    act(() => {
      root.render(createElement(OpenFileListener, { bridge }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(() => {
      act(() => {
        emit(OPEN_FILE_CHUNK_EVENT, fileChunk("a.mcap", 0, 1, "foo"));
      });
    }).not.toThrow();
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
