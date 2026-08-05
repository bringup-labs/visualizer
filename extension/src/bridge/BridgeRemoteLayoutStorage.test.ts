// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ISO8601Timestamp } from "@lichtblick/suite-base/services/ILayoutStorage";
import { RemoteLayout } from "@lichtblick/suite-base/services/IRemoteLayoutStorage";

import { BridgeRemoteLayoutStorage } from "./BridgeRemoteLayoutStorage";

function makeClientStub(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; req: unknown }> = [];
  return {
    calls,
    client: {
      request: async <T = unknown>(method: string, req: unknown): Promise<T> => {
        calls.push({ method, req });
        const value = responses[method];
        if (value instanceof Error) {
          throw value;
        }
        return value as T;
      },
    },
  };
}

const remoteLayout: RemoteLayout = {
  id: "lay-1" as LayoutID,
  externalId: "ext-1",
  name: "Perception Debug",
  data: {} as RemoteLayout["data"],
  permission: "ORG_READ",
  savedAt: "2026-08-02T10:00:00Z" as ISO8601Timestamp,
};

describe("BridgeRemoteLayoutStorage", () => {
  it("exposes the workspace it was constructed with", () => {
    const { client } = makeClientStub({});
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");
    expect(storage.workspace).toBe("org-a");
  });

  it("lists remote layouts in one request", async () => {
    const { client, calls } = makeClientStub({ "layouts.remote.list": [remoteLayout] });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayouts()).resolves.toEqual([remoteLayout]);
    expect(calls).toEqual([{ method: "layouts.remote.list", req: {} }]);
  });

  it("propagates errors from getLayouts instead of returning an empty list", async () => {
    // Critical: computeLayoutSyncOperations resolves a tracked layout that is
    // absent from the remote list as delete-local. Swallowing an error into []
    // would wipe every cached org layout.
    const { client } = makeClientStub({
      "layouts.remote.list": new Error("No active organization session"),
    });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayouts()).rejects.toThrow("No active organization session");
  });

  it("throws when the host returns a non-array list", async () => {
    const { client } = makeClientStub({ "layouts.remote.list": undefined });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayouts()).rejects.toThrow(/expected an array/i);
  });

  it("throws when the host returns a single object instead of a list", async () => {
    // A host regression that returns the layout envelope rather than the array
    // must not degrade into "the org has no layouts" - see above.
    const { client } = makeClientStub({ "layouts.remote.list": { layouts: [remoteLayout] } });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayouts()).rejects.toThrow(/expected an array/i);
  });

  it("gets a single layout by the CLIENT layout id, not the external id", async () => {
    // LayoutManager.getLayout passes a LayoutID on the cache-miss path, whereas
    // deleteLayout passes externalId. The service keys this route on layout_id.
    const { client, calls } = makeClientStub({ "layouts.remote.get": remoteLayout });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayout("lay-1" as LayoutID)).resolves.toEqual(remoteLayout);
    expect(calls[0]).toEqual({ method: "layouts.remote.get", req: { id: "lay-1" } });
  });

  it("resolves undefined when the layout is not on the server", async () => {
    const { client } = makeClientStub({ "layouts.remote.get": undefined });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.getLayout("gone" as LayoutID)).resolves.toBeUndefined();
  });

  it("saves a new layout", async () => {
    const { client, calls } = makeClientStub({ "layouts.remote.create": remoteLayout });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(
      storage.saveNewLayout({
        id: "lay-1" as LayoutID,
        name: "Perception Debug",
        permission: "ORG_READ",
        data: {} as RemoteLayout["data"],
      }),
    ).resolves.toEqual(remoteLayout);
    expect(calls[0]).toEqual({
      method: "layouts.remote.create",
      req: { layoutId: "lay-1", name: "Perception Debug", data: {}, permission: "ORG_READ" },
    });
  });

  it("forwards savedAt on update so the server can detect conflicts", async () => {
    const { client, calls } = makeClientStub({
      "layouts.remote.update": { status: "success", newLayout: remoteLayout },
    });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(
      storage.updateLayout({
        id: "lay-1" as LayoutID,
        externalId: "ext-1",
        name: "Renamed",
        savedAt: "2026-08-02T10:00:00Z" as ISO8601Timestamp,
      }),
    ).resolves.toEqual({ status: "success", newLayout: remoteLayout });
    expect(calls[0]).toEqual({
      method: "layouts.remote.update",
      req: {
        externalId: "ext-1",
        name: "Renamed",
        data: undefined,
        permission: undefined,
        savedAt: "2026-08-02T10:00:00Z",
      },
    });
  });

  it("returns the conflict result unchanged", async () => {
    const { client } = makeClientStub({ "layouts.remote.update": { status: "conflict" } });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(
      storage.updateLayout({
        id: "lay-1" as LayoutID,
        externalId: "ext-1",
        name: "Renamed",
        savedAt: "2026-08-02T10:00:00Z" as ISO8601Timestamp,
      }),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("deletes by externalId", async () => {
    const { client, calls } = makeClientStub({ "layouts.remote.delete": true });
    const storage = new BridgeRemoteLayoutStorage(client, "org-a");

    await expect(storage.deleteLayout("ext-1")).resolves.toBe(true);
    expect(calls).toEqual([{ method: "layouts.remote.delete", req: { externalId: "ext-1" } }]);
  });
});
