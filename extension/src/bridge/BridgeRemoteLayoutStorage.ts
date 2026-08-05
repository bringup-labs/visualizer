// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  SaveNewLayoutParams,
  UpdateLayoutRequest,
  UpdateLayoutResponse,
} from "@lichtblick/suite-base/api/layouts/types";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@lichtblick/suite-base/services/IRemoteLayoutStorage";

import { BridgeClient } from "./BridgeClient";
import { VIS_BRIDGE } from "./types";

/**
 * Organization layouts served by bringup_layout_service, reached through the
 * ext_visualizer host over bridge RPC. The host attaches the org-scoped token
 * and is restricted to the gateway origin, so this class never sees a
 * credential and cannot reach an arbitrary URL.
 */
export class BridgeRemoteLayoutStorage implements IRemoteLayoutStorage {
  public readonly workspace: string;

  #client: Pick<BridgeClient, "request">;

  public constructor(client: Pick<BridgeClient, "request">, workspace: string) {
    this.#client = client;
    this.workspace = workspace;
  }

  /**
   * Lists the organization's layouts.
   *
   * Rejects on any failure and never resolves to an empty array as an error
   * signal: `computeLayoutSyncOperations` treats a `tracked` layout missing
   * from this list as `delete-local`, so a swallowed error would delete the
   * user's cached org layouts.
   */
  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    const layouts = await this.#client.request<RemoteLayout[] | undefined>(
      VIS_BRIDGE.layoutsRemoteList,
      {},
    );
    if (!Array.isArray(layouts)) {
      throw new Error(`layouts.remote.list: expected an array, got ${typeof layouts}`);
    }
    return layouts;
  }

  /**
   * Fetches one layout by its client `LayoutID`.
   *
   * `LayoutManager.getLayout` passes a `LayoutID` here, while `deleteLayout`
   * receives the server-side `externalId`. The service keys this route on the
   * `layout_id` column to match — the two id spaces are not interchangeable.
   */
  public async getLayout(id: LayoutID): Promise<RemoteLayout | undefined> {
    return await this.#client.request<RemoteLayout | undefined>(VIS_BRIDGE.layoutsRemoteGet, {
      id,
    });
  }

  /** Creates a layout on the server under the client `LayoutID` in `params.id`. */
  public async saveNewLayout(params: SaveNewLayoutParams): Promise<RemoteLayout> {
    return await this.#client.request<RemoteLayout>(VIS_BRIDGE.layoutsRemoteCreate, {
      layoutId: params.id,
      name: params.name,
      data: params.data,
      permission: params.permission,
    });
  }

  /**
   * Updates a layout addressed by its server-side `externalId`.
   *
   * `savedAt` is the optimistic-concurrency token: the server compares it
   * against the stored timestamp and answers `{ status: "conflict" }` when
   * someone else wrote in the meantime. Dropping it would silently overwrite
   * another user's edit.
   */
  public async updateLayout(params: UpdateLayoutRequest): Promise<UpdateLayoutResponse> {
    return await this.#client.request<UpdateLayoutResponse>(VIS_BRIDGE.layoutsRemoteUpdate, {
      externalId: params.externalId,
      name: params.name,
      data: params.data,
      permission: params.permission,
      savedAt: params.savedAt,
    });
  }

  /**
   * Deletes a layout addressed by its server-side `externalId` — not a client
   * `LayoutID`. Returns true if the layout existed and was deleted.
   */
  public async deleteLayout(id: string): Promise<boolean> {
    return await this.#client.request<boolean>(VIS_BRIDGE.layoutsRemoteDelete, {
      externalId: id,
    });
  }
}
