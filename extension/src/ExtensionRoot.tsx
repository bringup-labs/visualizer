// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useState } from "react";

import {
  AppSetting,
  FoxgloveWebSocketDataSourceFactory,
  IDataSourceFactory,
  IExtensionLoader,
  McapLocalDataSourceFactory,
  MinioDataSourceFactory,
  RemoteDataSourceFactory,
  Ros1LocalBagDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  SharedRoot,
  StudioApp,
  UlogLocalDataSourceFactory,
  ZenohDataSourceFactory,
} from "@lichtblick/suite-base";
import LayoutStorageContext from "@lichtblick/suite-base/context/LayoutStorageContext";

import { OpenFileListener } from "./OpenFileListener";
import { BridgeAppConfiguration } from "./bridge/BridgeAppConfiguration";
import { BridgeClient } from "./bridge/BridgeClient";
import { BridgeExtensionLoader } from "./bridge/BridgeExtensionLoader";
import { BridgeLayoutStorage } from "./bridge/BridgeLayoutStorage";

/**
 * Root component for the embedded (bringup webview) build: wires the bridge-backed providers
 * (config, layouts, plugins) into the Lichtblick app shell.
 */
export function ExtensionRoot(props: {
  bridge: BridgeClient;
  appConfiguration: BridgeAppConfiguration;
}): React.JSX.Element {
  const { bridge, appConfiguration } = props;

  const [extensionLoaders] = useState<IExtensionLoader[]>(() => [
    new BridgeExtensionLoader(bridge),
  ]);
  const [layoutStorage] = useState(() => new BridgeLayoutStorage(bridge));

  // Deep link resolved from the host's one-shot pending Zenoh source. `undefined` means the
  // bridge round-trip is still in flight and we should not render yet; once resolved it is a
  // (possibly empty) list passed straight to SharedRoot.
  const [deepLinks, setDeepLinks] = useState<readonly string[] | undefined>(undefined);

  // Same set and order as WebRoot, minus SampleNuscenes (no demo data source in the embedded
  // panel).
  const dataSources: IDataSourceFactory[] = useMemo(
    () => [
      new Ros1LocalBagDataSourceFactory(),
      new Ros2LocalBagDataSourceFactory(),
      new FoxgloveWebSocketDataSourceFactory(),
      new RosbridgeDataSourceFactory(),
      new UlogLocalDataSourceFactory(),
      new McapLocalDataSourceFactory(),
      new MinioDataSourceFactory(),
      new RemoteDataSourceFactory(),
      new ZenohDataSourceFactory(),
    ],
    [],
  );

  // Follow the host application's theme.
  useEffect(() => {
    return bridge.onEvent("theme", (payload) => {
      const kind = (payload as { kind?: unknown } | undefined)?.kind;
      if (kind === "dark" || kind === "light") {
        void appConfiguration.set(AppSetting.COLOR_SCHEME, kind);
      }
    });
  }, [bridge, appConfiguration]);

  // Consume the host's one-shot pending Zenoh source (set by the visualizer.openZenohSource
  // command) exactly once at mount, turning it into a deep link that auto-selects the source.
  useEffect(() => {
    void bridge
      .request<{ url: string | null }>("zenoh.pendingSource", {})
      .then((res) => {
        setDeepLinks(
          res.url
            ? [`bringup://open?ds=zenoh&ds.url=${encodeURIComponent(res.url)}`]
            : [],
        );
      })
      .catch(() => {
        setDeepLinks([]);
      });
  }, [bridge]);

  // Wait for the single pending-source round-trip before the first render so the deep link is
  // applied on initial mount rather than after the app has already picked a source.
  if (deepLinks == undefined) {
    return <></>;
  }

  return (
    <SharedRoot
      enableGlobalCss
      deepLinks={deepLinks}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      extensionLoaders={extensionLoaders}
    >
      <LayoutStorageContext.Provider value={layoutStorage}>
        <>
          <OpenFileListener bridge={bridge} />
          <StudioApp />
        </>
      </LayoutStorageContext.Provider>
    </SharedRoot>
  );
}
