// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Wire protocol between the visualizer webview and the ext_visualizer host. */

export type BridgeRequest = { type: "request"; id: string; method: string; req: unknown };

export type BridgeResponse =
  | { type: "response"; id: string; ok: true; data: unknown }
  | { type: "response"; id: string; ok: false; error: string };

/** Host-initiated push (theme changes, open-file chunks). */
export type BridgeEvent = { type: "event"; event: string; payload: unknown };

export type BridgeMessage = BridgeResponse | BridgeEvent;

export const VIS_BRIDGE = {
  configGetAll: "config.getAll",
  configSet: "config.set",
  layoutsList: "layouts.list",
  layoutsGet: "layouts.get",
  layoutsPut: "layouts.put",
  layoutsDelete: "layouts.delete",
  layoutsImport: "layouts.import",
  layoutsRemoteList: "layouts.remote.list",
  layoutsRemoteGet: "layouts.remote.get",
  layoutsRemoteCreate: "layouts.remote.create",
  layoutsRemoteUpdate: "layouts.remote.update",
  layoutsRemoteDelete: "layouts.remote.delete",
  sessionGetOrgContext: "session.getOrgContext",
  pluginsList: "plugins.list",
  pluginsGet: "plugins.get",
  pluginsGetData: "plugins.getData",
  pluginsInstall: "plugins.install",
  pluginsUninstall: "plugins.uninstall",
  themeGet: "theme.get",
  /** Webview → host: "my open-file listener is subscribed; send what is waiting." */
  openFilePending: "openFile.pending",
} as const;
