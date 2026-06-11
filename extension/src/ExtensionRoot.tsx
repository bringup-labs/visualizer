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

  return (
    <SharedRoot
      enableGlobalCss
      deepLinks={[]}
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
