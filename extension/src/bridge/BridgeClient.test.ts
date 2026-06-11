// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BridgeClient, BridgeTransport } from "./BridgeClient";

function makeFakeTransport() {
  const sent: any[] = [];
  let receive: (msg: unknown) => void = () => {};
  const transport: BridgeTransport = {
    send: (msg) => sent.push(msg),
    onMessage: (cb) => {
      receive = cb;
    },
  };
  return {
    transport,
    sent,
    push: (msg: unknown) => {
      receive(msg);
    },
  };
}

describe("BridgeClient", () => {
  it("correlates responses by id", async () => {
    const { transport, sent, push } = makeFakeTransport();
    const client = new BridgeClient(transport);
    const promise = client.request("config.getAll", {});
    expect(sent).toHaveLength(1);
    push({ type: "response", id: sent[0].id, ok: true, data: { a: 1 } });
    await expect(promise).resolves.toEqual({ a: 1 });
  });

  it("rejects on error responses", async () => {
    const { transport, sent, push } = makeFakeTransport();
    const client = new BridgeClient(transport);
    const promise = client.request("layouts.get", { id: "x" });
    push({ type: "response", id: sent[0].id, ok: false, error: "nope" });
    await expect(promise).rejects.toThrow("nope");
  });

  it("dispatches events to subscribers and supports unsubscribe", () => {
    const { transport, push } = makeFakeTransport();
    const client = new BridgeClient(transport);
    const seen: unknown[] = [];
    const off = client.onEvent("theme", (payload) => seen.push(payload));
    push({ type: "event", event: "theme", payload: { kind: "dark" } });
    off();
    push({ type: "event", event: "theme", payload: { kind: "light" } });
    expect(seen).toEqual([{ kind: "dark" }]);
  });

  it("times out requests", async () => {
    jest.useFakeTimers();
    try {
      const { transport } = makeFakeTransport();
      const client = new BridgeClient(transport, { timeoutMs: 1000 });
      const promise = client.request("config.getAll", {});
      jest.advanceTimersByTime(1001);
      await expect(promise).rejects.toThrow(/timed out/);
    } finally {
      jest.useRealTimers();
    }
  });
});
