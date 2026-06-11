// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  AppConfigurationValue,
  ChangeHandler,
  IAppConfiguration,
} from "@lichtblick/suite-base/context/AppConfigurationContext";

import { BridgeClient } from "./BridgeClient";
import { VIS_BRIDGE } from "./types";

/**
 * App settings backed by the ext_visualizer host (persisted to a JSON file on
 * disk). Reads are synchronous against a snapshot taken at startup; writes go
 * through the bridge.
 */
export class BridgeAppConfiguration implements IAppConfiguration {
  #values: Map<string, AppConfigurationValue>;
  #listeners: Map<string, Set<ChangeHandler>>;
  #client: Pick<BridgeClient, "request" | "onEvent">;

  public constructor(
    client: Pick<BridgeClient, "request" | "onEvent">,
    initialValues: Record<string, AppConfigurationValue>,
  ) {
    this.#client = client;
    this.#values = new Map(Object.entries(initialValues));
    this.#listeners = new Map();
  }

  public get(key: string): AppConfigurationValue {
    return this.#values.get(key);
  }

  public async set(key: string, value: AppConfigurationValue): Promise<void> {
    this.#values.set(key, value);
    const listeners = this.#listeners.get(key);
    if (listeners) {
      for (const cb of [...listeners]) {
        cb(value);
      }
    }
    await this.#client.request(VIS_BRIDGE.configSet, { key, value });
  }

  public addChangeListener(key: string, cb: ChangeHandler): void {
    let listeners = this.#listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    listeners.add(cb);
  }

  public removeChangeListener(key: string, cb: ChangeHandler): void {
    this.#listeners.get(key)?.delete(cb);
  }
}
