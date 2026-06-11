// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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

  // Fetch the persisted config and the current theme in parallel.
  const [initialConfig, theme] = await Promise.all([
    bridge.request<Record<string, string | number | boolean | undefined>>(
      VIS_BRIDGE.configGetAll,
      {},
    ),
    bridge.request<{ kind: "dark" | "light" }>(VIS_BRIDGE.themeGet, {}),
  ]);

  // The desktop app's theme is authoritative for the embedded panel (theme-sync design).
  const appConfiguration = new BridgeAppConfiguration(bridge, {
    ...initialConfig,
    [AppSetting.COLOR_SCHEME]: theme.kind,
  });

  await main(async () => ({
    rootElement: <ExtensionRoot bridge={bridge} appConfiguration={appConfiguration} />,
  }));
}

start().catch((err: unknown) => {
  console.error("[extension] startup failed", err);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#ccc;background:#1a1a1a;gap:12px;padding:24px;box-sizing:border-box;text-align:center;">
        <div style="font-size:16px;">Visualizer couldn't reach its host process. Close and reopen the panel.</div>
        <div style="font-size:12px;opacity:0.6;">${err instanceof Error ? err.message : String(err)}</div>
      </div>`;
  }
});
