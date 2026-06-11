// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AppSetting } from "@lichtblick/suite-base";
import { main } from "@lichtblick/suite-web";

import { ExtensionRoot } from "./ExtensionRoot";
import { BridgeAppConfiguration } from "./bridge/BridgeAppConfiguration";
import { createBridge } from "./bridge/BridgeClient";
import { VIS_BRIDGE } from "./bridge/types";
import { neutralizeFileSystemAccessApi } from "./neutralizeFileSystemAccessApi";

async function start(): Promise<void> {
  neutralizeFileSystemAccessApi();

  const bridge = createBridge();
  const initialConfig = await bridge.request<Record<string, string | number | boolean | undefined>>(
    VIS_BRIDGE.configGetAll,
    {},
  );
  const theme = await bridge.request<{ kind: "dark" | "light" }>(VIS_BRIDGE.themeGet, {});
  const appConfiguration = new BridgeAppConfiguration(bridge, {
    [AppSetting.COLOR_SCHEME]: theme.kind,
    ...initialConfig,
  });

  await main(async () => ({
    rootElement: <ExtensionRoot bridge={bridge} appConfiguration={appConfiguration} />,
  }));
}

void start();
