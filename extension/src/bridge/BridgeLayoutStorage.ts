// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ILayoutStorage, Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

import { BridgeClient } from "./BridgeClient";
import { VIS_BRIDGE } from "./types";

/**
 * Layouts persisted as JSON files by the ext_visualizer host, accessed via bridge RPC.
 */
export class BridgeLayoutStorage implements ILayoutStorage {
  #client: Pick<BridgeClient, "request">;

  public constructor(client: Pick<BridgeClient, "request">) {
    this.#client = client;
  }

  public async list(namespace: string): Promise<readonly Layout[]> {
    return await this.#client.request<Layout[]>(VIS_BRIDGE.layoutsList, { namespace });
  }

  public async get(namespace: string, id: LayoutID): Promise<Layout | undefined> {
    return await this.#client.request<Layout | undefined>(VIS_BRIDGE.layoutsGet, { namespace, id });
  }

  public async put(namespace: string, layout: Layout): Promise<Layout> {
    return await this.#client.request<Layout>(VIS_BRIDGE.layoutsPut, { namespace, layout });
  }

  public async delete(namespace: string, id: LayoutID): Promise<void> {
    await this.#client.request<void>(VIS_BRIDGE.layoutsDelete, { namespace, id });
  }

  public async importLayouts({
    fromNamespace,
    toNamespace,
  }: {
    fromNamespace: string;
    toNamespace: string;
  }): Promise<void> {
    await this.#client.request<void>(VIS_BRIDGE.layoutsImport, { fromNamespace, toNamespace });
  }
}
