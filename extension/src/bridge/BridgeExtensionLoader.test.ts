// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import JSZip from "jszip";

import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

import { BridgeExtensionLoader, fromBase64, toBase64 } from "./BridgeExtensionLoader";

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

const EXTENSION_SOURCE = `module.exports = { activate: () => {} };`;

async function makeFoxe(): Promise<Uint8Array> {
  const zip = new JSZip();
  const packageJson = JSON.stringify({
    name: "@acme/cool-panel",
    publisher: "Acme",
    displayName: "Cool Panel",
    description: "A cool panel",
    version: "1.0.0",
    license: "MPL-2.0",
  })!;
  zip.file("package.json", packageJson);
  zip.file("dist/extension.js", EXTENSION_SOURCE);
  zip.file("README.md", "readme contents");
  zip.file("CHANGELOG.md", "changelog contents");
  return await zip.generateAsync({ type: "uint8array" });
}

describe("BridgeExtensionLoader", () => {
  it("lists extensions from the host", async () => {
    const infos = [{ id: "pub.thing", name: "thing" }] as ExtensionInfo[];
    const { client, calls } = makeClientStub({ "plugins.list": infos });
    const loader = new BridgeExtensionLoader(client);
    await expect(loader.getExtensions()).resolves.toEqual(infos);
    expect(calls).toEqual([{ method: "plugins.list", req: {} }]);
    expect(loader.namespace).toBe("local");
    expect(loader.type).toBe("browser");
  });

  it("getExtension forwards the id", async () => {
    const info = { id: "pub.thing", name: "thing" } as ExtensionInfo;
    const { client, calls } = makeClientStub({ "plugins.get": info });
    const loader = new BridgeExtensionLoader(client);
    await expect(loader.getExtension("pub.thing")).resolves.toEqual(info);
    expect(calls).toEqual([{ method: "plugins.get", req: { id: "pub.thing" } }]);
  });

  it("uninstall forwards the id", async () => {
    const { client, calls } = makeClientStub({});
    const loader = new BridgeExtensionLoader(client);
    await loader.uninstallExtension("pub.thing");
    expect(calls).toEqual([{ method: "plugins.uninstall", req: { id: "pub.thing" } }]);
  });

  it("base64 helpers round-trip bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    // a larger buffer crossing the chunking boundary (>0x8000 elements)
    const big = new Uint8Array(70000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
  });

  it("installExtension parses the foxe and sends info + bytes to the host", async () => {
    const foxe = await makeFoxe();
    const { client, calls } = makeClientStub({});
    const loader = new BridgeExtensionLoader(client);

    const info = await loader.installExtension({ foxeFileData: foxe, externalId: "ext-1" });

    // same metadata IdbExtensionLoader would produce
    expect(info).toMatchObject({
      id: "Acme.cool-panel",
      name: "cool-panel",
      publisher: "Acme",
      displayName: "Cool Panel",
      namespace: "local",
      qualifiedName: "Cool Panel",
      readme: "readme contents",
      changelog: "changelog contents",
      externalId: "ext-1",
      size: foxe.length,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("plugins.install");
    const req = call.req as { info: ExtensionInfo; dataB64: string };
    expect(req.info).toEqual(info);
    expect(fromBase64(req.dataB64)).toEqual(foxe);
  });

  it("loadExtension extracts the raw JS source from host-provided bytes", async () => {
    const foxe = await makeFoxe();
    const { client, calls } = makeClientStub({ "plugins.getData": { dataB64: toBase64(foxe) } });
    const loader = new BridgeExtensionLoader(client);

    const loaded = await loader.loadExtension("Acme.cool-panel");

    expect(calls).toEqual([{ method: "plugins.getData", req: { id: "Acme.cool-panel" } }]);
    expect(loaded.raw).toBe(EXTENSION_SOURCE);
    expect(loaded.buffer).toEqual(foxe);
  });

  it("loadExtension throws when the host has no data for the id", async () => {
    const { client } = makeClientStub({ "plugins.getData": undefined });
    const loader = new BridgeExtensionLoader(client);
    await expect(loader.loadExtension("nope")).rejects.toThrow("Extension not found");
  });

  it("installExtension rejects a foxe without package.json", async () => {
    const zip = new JSZip();
    zip.file("dist/extension.js", EXTENSION_SOURCE);
    const foxe = await zip.generateAsync({ type: "uint8array" });
    const { client, calls } = makeClientStub({});
    const loader = new BridgeExtensionLoader(client);
    await expect(loader.installExtension({ foxeFileData: foxe })).rejects.toThrow(
      `File "package.json" is missing`,
    );
    expect(calls).toHaveLength(0);
  });
});
