// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import ZenohPlayer from "@lichtblick/suite-base/players/ZenohPlayer";
import { Player } from "@lichtblick/suite-base/players/types";

export default class ZenohDataSourceFactory implements IDataSourceFactory {
  public id = "zenoh";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Zenoh (BringUp)";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description =
    "Live ROS 2 topics from a BringUp device over the mesh (zenoh remote-api WebSocket).";

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "WebSocket URL",
        defaultValue: "ws://100.64.0.1:10000",
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.protocol !== "ws:" && url.protocol !== "wss:") {
              return new Error(`Invalid protocol: ${url.protocol}`);
            }
            return undefined;
          } catch (err: unknown) {
            console.error(err);
            return new Error("Enter a valid url");
          }
        },
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    if (!url) {
      return;
    }

    return new ZenohPlayer({ url, sourceId: this.id });
  }
}
