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
import { AppContext, IAppContext } from "@lichtblick/suite-base/context/AppContext";
import LayoutStorageContext from "@lichtblick/suite-base/context/LayoutStorageContext";
// Named export — unlike LayoutStorageContext, which is a default export.
import { RemoteLayoutStorageContext } from "@lichtblick/suite-base/context/RemoteLayoutStorageContext";

import { OpenFileListener } from "./OpenFileListener";
import { OrgLayoutDropdown } from "./OrgLayoutDropdown";
import { BridgeAppConfiguration } from "./bridge/BridgeAppConfiguration";
import { BridgeClient } from "./bridge/BridgeClient";
import { BridgeExtensionLoader } from "./bridge/BridgeExtensionLoader";
import { BridgeLayoutStorage } from "./bridge/BridgeLayoutStorage";
import { BridgeRemoteLayoutStorage } from "./bridge/BridgeRemoteLayoutStorage";
import { VIS_BRIDGE } from "./bridge/types";

type OrgContext = { orgId: string; orgRole: string };

/** Roles permitted to publish into the read-only org catalog. Advisory only:
 *  the layout service re-checks with Cerbos and rejects regardless. */
const CATALOG_PUBLISHER_ROLES = ["owner", "admin"];

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

  // The org context decides whether organization layouts are available at all.
  // The one-field wrapper distinguishes "lookup still in flight" (the state is
  // undefined) from "resolved, but signed out or no active organization"
  // (`{ value: undefined }`) — the latter is a normal state, not an error.
  const [orgLookup, setOrgLookup] = useState<{ value: OrgContext | undefined } | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    bridge
      .request<OrgContext | undefined>(VIS_BRIDGE.sessionGetOrgContext, {})
      .then((ctx) => {
        if (!cancelled) {
          // The host preserves `undefined` for a signed-out user; over IPC that
          // arrives as an absent `data` key. It is not an org with a missing id.
          setOrgLookup({ value: ctx });
        }
      })
      .catch(() => {
        // Treat a failed lookup as "no organization": the app still works with
        // personal layouts, which is better than blocking startup.
        if (!cancelled) {
          setOrgLookup({ value: undefined });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const orgContext = orgLookup?.value;

  // IRemoteLayoutStorage.workspace is synchronous, so the storage can only be
  // built once the org id is known. With no org we provide nothing, which
  // leaves supportsSharing false and the app on personal layouts only.
  const remoteLayoutStorage = useMemo(
    () =>
      orgContext == undefined ? undefined : new BridgeRemoteLayoutStorage(bridge, orgContext.orgId),
    [bridge, orgContext],
  );

  const appContextValue = useMemo<IAppContext>(
    () => ({
      wrapPlayer: (child) => child,
      appBarLayoutButton: <OrgLayoutDropdown />,
      orgLayoutCapabilities: {
        canPublishCatalog:
          orgContext != undefined && CATALOG_PUBLISHER_ROLES.includes(orgContext.orgRole),
      },
    }),
    [orgContext],
  );

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

  // Wait for the org lookup before mounting the app: LayoutManager picks its
  // namespace at construction, so mounting first and adding remote storage
  // later would build the manager against the wrong namespace.
  if (orgLookup == undefined) {
    return <></>;
  }

  const app = (
    <AppContext.Provider value={appContextValue}>
      <LayoutStorageContext.Provider value={layoutStorage}>
        <>
          <OpenFileListener bridge={bridge} />
          <StudioApp />
        </>
      </LayoutStorageContext.Provider>
    </AppContext.Provider>
  );

  return (
    <SharedRoot
      enableGlobalCss
      deepLinks={[]}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      extensionLoaders={extensionLoaders}
    >
      {remoteLayoutStorage == undefined ? (
        app
      ) : (
        // Keyed on the org id so switching organizations remounts LayoutManager
        // onto the new remote-<orgId> namespace instead of serving the previous
        // org's cache.
        <RemoteLayoutStorageContext.Provider
          key={remoteLayoutStorage.workspace}
          value={remoteLayoutStorage}
        >
          {app}
        </RemoteLayoutStorageContext.Provider>
      )}
    </SharedRoot>
  );
}
