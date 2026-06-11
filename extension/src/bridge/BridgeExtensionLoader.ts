// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  IExtensionLoader,
  InstallExtensionProps,
  LoadedExtension,
  TypeExtensionLoader,
} from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import { ALLOWED_FILES } from "@lichtblick/suite-base/services/extension/types";
import decompressFile from "@lichtblick/suite-base/services/extension/utils/decompressFile";
import extractFoxeFileContent from "@lichtblick/suite-base/services/extension/utils/extractFoxeFileContent";
import validatePackageInfo from "@lichtblick/suite-base/services/extension/utils/validatePackageInfo";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

import { BridgeClient } from "./BridgeClient";
import { VIS_BRIDGE } from "./types";

/** Convert bytes chunk-wise to keep String.fromCharCode within argument limits. */
const BASE64_CHUNK_SIZE = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

export function fromBase64(dataB64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(dataB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Lichtblick `.foxe` extension loader backed by the ext_visualizer host's plugin
 * directory, accessed via bridge RPC.
 *
 * The host is a plain byte/info store; all `.foxe` parsing (zip -> package.json ->
 * {@link ExtensionInfo}; zip -> main JS source) happens here, through the same
 * helpers `IdbExtensionLoader` uses, so installed plugins get identical metadata
 * to the web build.
 */
export class BridgeExtensionLoader implements IExtensionLoader {
  public readonly namespace: Namespace = "local";
  // "browser" matches web behavior; "filesystem" can trip desktop-only paths in the catalog UI.
  public readonly type: TypeExtensionLoader = "browser";

  #client: Pick<BridgeClient, "request">;

  public constructor(client: Pick<BridgeClient, "request">) {
    this.#client = client;
  }

  public async getExtension(id: string): Promise<ExtensionInfo | undefined> {
    return await this.#client.request<ExtensionInfo | undefined>(VIS_BRIDGE.pluginsGet, { id });
  }

  public async getExtensions(): Promise<ExtensionInfo[]> {
    return await this.#client.request<ExtensionInfo[]>(VIS_BRIDGE.pluginsList, {});
  }

  public async loadExtension(id: string): Promise<LoadedExtension> {
    const data = await this.#client.request<{ dataB64: string } | undefined>(
      VIS_BRIDGE.pluginsGetData,
      { id },
    );
    if (!data) {
      throw new Error("Extension not found");
    }

    const content = fromBase64(data.dataB64);
    const decompressedData = await decompressFile(content);
    const rawExtensionFile = await extractFoxeFileContent(
      decompressedData,
      ALLOWED_FILES.EXTENSION,
    );
    if (!rawExtensionFile) {
      throw new Error(`Extension is corrupted: missing ${ALLOWED_FILES.EXTENSION}`);
    }

    return {
      buffer: content,
      raw: rawExtensionFile,
    };
  }

  public async installExtension({
    foxeFileData,
    externalId,
  }: InstallExtensionProps): Promise<ExtensionInfo> {
    const decompressedData = await decompressFile(foxeFileData);
    const rawPackageFile = await extractFoxeFileContent(decompressedData, ALLOWED_FILES.PACKAGE);
    if (!rawPackageFile) {
      throw new Error(
        `Corrupted extension. File "${ALLOWED_FILES.PACKAGE}" is missing in the extension source.`,
      );
    }
    const readme = (await extractFoxeFileContent(decompressedData, ALLOWED_FILES.README)) ?? "";
    const changelog =
      (await extractFoxeFileContent(decompressedData, ALLOWED_FILES.CHANGELOG)) ?? "";

    const rawInfo = validatePackageInfo(JSON.parse(rawPackageFile) as Partial<ExtensionInfo>);
    const normalizedPublisher = rawInfo.publisher.replace(/[^A-Za-z0-9_\s]+/g, "");

    const info: ExtensionInfo = {
      ...rawInfo,
      id: `${normalizedPublisher}.${rawInfo.name}`,
      namespace: this.namespace,
      qualifiedName: rawInfo.displayName || rawInfo.name,
      readme,
      changelog,
      externalId,
      size: foxeFileData.length,
    };

    await this.#client.request(VIS_BRIDGE.pluginsInstall, {
      info,
      dataB64: toBase64(foxeFileData),
    });

    return info;
  }

  public async uninstallExtension(id: string): Promise<void> {
    await this.#client.request(VIS_BRIDGE.pluginsUninstall, { id });
  }
}
