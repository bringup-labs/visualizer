// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

import { BridgeLayoutStorage } from "./BridgeLayoutStorage";

function makeClientStub(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; req: unknown }> = [];
  return {
    calls,
    client: {
      request: async <T = unknown>(method: string, req: unknown): Promise<T> => {
        calls.push({ method, req });
        return responses[method] as T;
      },
    },
  };
}

describe("BridgeLayoutStorage", () => {
  const layout = {
    id: "l1" as LayoutID,
    name: "Main",
    permission: "CREATOR_WRITE",
    baseline: { data: {}, savedAt: undefined },
    working: undefined,
    syncInfo: undefined,
  } as unknown as Layout;

  it("lists layouts for a namespace", async () => {
    const { client, calls } = makeClientStub({ "layouts.list": [layout] });
    const storage = new BridgeLayoutStorage(client);
    await expect(storage.list("local")).resolves.toEqual([layout]);
    expect(calls[0]).toEqual({ method: "layouts.list", req: { namespace: "local" } });
  });

  it("get returns undefined for missing layouts", async () => {
    const { client } = makeClientStub({ "layouts.get": undefined });
    const storage = new BridgeLayoutStorage(client);
    await expect(storage.get("local", "nope" as LayoutID)).resolves.toBeUndefined();
  });

  it("put round-trips the layout", async () => {
    const { client, calls } = makeClientStub({ "layouts.put": layout });
    const storage = new BridgeLayoutStorage(client);
    await expect(storage.put("local", layout)).resolves.toEqual(layout);
    expect(calls[0]).toEqual({ method: "layouts.put", req: { namespace: "local", layout } });
  });

  it("delete and importLayouts forward args", async () => {
    const { client, calls } = makeClientStub({});
    const storage = new BridgeLayoutStorage(client);
    await storage.delete("local", "l1" as LayoutID);
    await storage.importLayouts({ fromNamespace: "a", toNamespace: "b" });
    expect(calls).toEqual([
      { method: "layouts.delete", req: { namespace: "local", id: "l1" } },
      { method: "layouts.import", req: { fromNamespace: "a", toNamespace: "b" } },
    ]);
  });
});
