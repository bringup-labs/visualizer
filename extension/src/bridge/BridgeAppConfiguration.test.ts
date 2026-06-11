// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BridgeAppConfiguration } from "./BridgeAppConfiguration";
import { BridgeClient } from "./BridgeClient";

type ClientStub = Pick<BridgeClient, "request">;

function makeClientStub(): { calls: Array<{ method: string; req: unknown }>; client: ClientStub } {
  const calls: Array<{ method: string; req: unknown }> = [];
  const client: ClientStub = {
    request: async <T = unknown>(method: string, req: unknown): Promise<T> => {
      calls.push({ method, req });
      return {} as T;
    },
  };
  return { calls, client };
}

describe("BridgeAppConfiguration", () => {
  it("serves initial values synchronously", () => {
    const { client } = makeClientStub();
    const config = new BridgeAppConfiguration(client, { colorScheme: "dark" });
    expect(config.get("colorScheme")).toBe("dark");
    expect(config.get("missing")).toBeUndefined();
  });

  it("set updates cache, persists via bridge, and notifies listeners", async () => {
    const { client, calls } = makeClientStub();
    const config = new BridgeAppConfiguration(client, {});
    const seen: unknown[] = [];
    config.addChangeListener("colorScheme", (v) => {
      seen.push(v);
    });
    await config.set("colorScheme", "light");
    expect(config.get("colorScheme")).toBe("light");
    expect(seen).toEqual(["light"]);
    expect(calls).toEqual([{ method: "config.set", req: { key: "colorScheme", value: "light" } }]);
  });

  it("removeChangeListener stops notifications", async () => {
    const { client } = makeClientStub();
    const config = new BridgeAppConfiguration(client, {});
    const seen: unknown[] = [];
    const cb = (v: unknown) => {
      seen.push(v);
    };
    config.addChangeListener("k", cb);
    config.removeChangeListener("k", cb);
    await config.set("k", 1);
    expect(seen).toEqual([]);
  });
});
