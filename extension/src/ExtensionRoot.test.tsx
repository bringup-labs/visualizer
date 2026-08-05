/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, createElement, useEffect } from "react";
import { createRoot, Root } from "react-dom/client";

import { useAppContext } from "@lichtblick/suite-base/context/AppContext";
import { useRemoteLayoutStorage } from "@lichtblick/suite-base/context/RemoteLayoutStorageContext";

import { ExtensionRoot } from "./ExtensionRoot";
import { BridgeAppConfiguration } from "./bridge/BridgeAppConfiguration";
import { BridgeClient } from "./bridge/BridgeClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `jest.mock` factories may only close over identifiers prefixed with "mock".
// These aliases are read when the mocked component renders, long after the
// factory has run, so the temporal dead zone is not a concern.
const mockUseEffect = useEffect;
const mockUseAppContext = useAppContext;
const mockUseRemoteLayoutStorage = useRemoteLayoutStorage;

/**
 * What the app subtree saw when it last rendered. `StudioApp` is replaced by a
 * probe that records the contexts ExtensionRoot is responsible for providing,
 * which is the only way to observe them from outside the provider tree.
 */
const mockObserved: {
  mounts: number;
  hasRemoteStorage: boolean;
  workspace: undefined | string;
  canPublishCatalog: undefined | boolean;
  hasLayoutButton: boolean;
  playerPassedThrough: boolean;
} = {
  mounts: 0,
  hasRemoteStorage: false,
  workspace: undefined,
  canPublishCatalog: undefined,
  hasLayoutButton: false,
  playerPassedThrough: false,
};

// The real barrel drags in the whole Lichtblick app, including ESM-only
// transitive dependencies the extension's jest transform does not process.
jest.mock("@lichtblick/suite-base", () => ({
  AppSetting: { COLOR_SCHEME: "colorScheme" },
  SharedRoot: (props: { children?: unknown }) => props.children,
  StudioApp: () => {
    const remoteLayoutStorage = mockUseRemoteLayoutStorage();
    const appContext = mockUseAppContext();
    const player = {};

    mockObserved.hasRemoteStorage = remoteLayoutStorage != undefined;
    mockObserved.workspace = remoteLayoutStorage?.workspace;
    mockObserved.canPublishCatalog = appContext.orgLayoutCapabilities?.canPublishCatalog;
    mockObserved.hasLayoutButton = appContext.appBarLayoutButton != undefined;
    mockObserved.playerPassedThrough = appContext.wrapPlayer(player as never) === player;

    mockUseEffect(() => {
      mockObserved.mounts += 1;
    }, []);

    return null;
  },
  FoxgloveWebSocketDataSourceFactory: jest.fn(),
  McapLocalDataSourceFactory: jest.fn(),
  MinioDataSourceFactory: jest.fn(),
  RemoteDataSourceFactory: jest.fn(),
  Ros1LocalBagDataSourceFactory: jest.fn(),
  Ros2LocalBagDataSourceFactory: jest.fn(),
  RosbridgeDataSourceFactory: jest.fn(),
  UlogLocalDataSourceFactory: jest.fn(),
}));

jest.mock("./OrgLayoutDropdown", () => ({ OrgLayoutDropdown: () => null }));
jest.mock("./OpenFileListener", () => ({ OpenFileListener: () => null }));
jest.mock("./bridge/BridgeExtensionLoader", () => ({ BridgeExtensionLoader: jest.fn() }));

type OrgContextResponse = { orgId: string; orgRole: string } | undefined;

const bridgeCalls: string[] = [];

function makeBridge(orgContext: OrgContextResponse | Error | "pending"): BridgeClient {
  return {
    request: async (method: string) => {
      bridgeCalls.push(method);
      if (orgContext === "pending") {
        return await new Promise(() => {});
      }
      if (orgContext instanceof Error) {
        throw orgContext;
      }
      return orgContext;
    },
    onEvent: () => () => {},
  } as unknown as BridgeClient;
}

const appConfiguration = {
  set: async () => {},
} as unknown as BridgeAppConfiguration;

describe("ExtensionRoot org layout wiring", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    bridgeCalls.length = 0;
    mockObserved.mounts = 0;
    mockObserved.hasRemoteStorage = false;
    mockObserved.workspace = undefined;
    mockObserved.canPublishCatalog = undefined;
    mockObserved.hasLayoutButton = false;
    mockObserved.playerPassedThrough = false;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function mount(bridge: BridgeClient): Promise<void> {
    await act(async () => {
      root.render(createElement(ExtensionRoot, { bridge, appConfiguration }));
    });
  }

  it("does not mount the app until the org lookup resolves", async () => {
    await mount(makeBridge("pending"));

    // LayoutManager picks its namespace at construction, so mounting before the
    // org id is known would build it against the wrong namespace.
    expect(mockObserved.mounts).toBe(0);
  });

  it("provides remote layout storage scoped to the active org", async () => {
    await mount(makeBridge({ orgId: "org-a", orgRole: "member" }));

    expect(bridgeCalls).toEqual(["session.getOrgContext"]);
    expect(mockObserved.mounts).toBe(1);
    expect(mockObserved.hasRemoteStorage).toBe(true);
    expect(mockObserved.workspace).toBe("org-a");
  });

  it("provides no remote layout storage when there is no org session", async () => {
    await mount(makeBridge(undefined));

    expect(mockObserved.mounts).toBe(1);
    // Without the provider, LayoutManager.supportsSharing stays false and the
    // app degrades to personal layouts.
    expect(mockObserved.hasRemoteStorage).toBe(false);
  });

  it("provides no remote layout storage for a context with no org id", async () => {
    // A malformed host response must not namespace the layout cache as
    // `remote-`; it is not an org session with a missing id.
    await mount(makeBridge({ orgId: "", orgRole: "admin" }));

    expect(mockObserved.mounts).toBe(1);
    expect(mockObserved.hasRemoteStorage).toBe(false);
    expect(mockObserved.canPublishCatalog).toBe(false);
  });

  it("degrades to personal layouts when the org lookup fails", async () => {
    await mount(makeBridge(new Error("bridge unavailable")));

    expect(mockObserved.mounts).toBe(1);
    expect(mockObserved.hasRemoteStorage).toBe(false);
  });

  it("remounts the app when the org changes so the namespace is rebuilt", async () => {
    await mount(makeBridge({ orgId: "org-a", orgRole: "member" }));
    expect(mockObserved.workspace).toBe("org-a");

    await mount(makeBridge({ orgId: "org-b", orgRole: "member" }));

    expect(mockObserved.workspace).toBe("org-b");
    // Keyed on the org id: the subtree is torn down rather than reusing the
    // previous org's LayoutManager and its cache.
    expect(mockObserved.mounts).toBe(2);
  });

  it.each(["owner", "admin"])("lets an org %s publish to the catalog", async (orgRole) => {
    await mount(makeBridge({ orgId: "org-a", orgRole }));

    expect(mockObserved.canPublishCatalog).toBe(true);
  });

  it.each([
    "member",
    "viewer",
    "",
  ])("does not let an org %s publish to the catalog", async (orgRole) => {
    await mount(makeBridge({ orgId: "org-a", orgRole }));

    expect(mockObserved.canPublishCatalog).toBe(false);
  });

  it("does not offer catalog publishing without an org session", async () => {
    await mount(makeBridge(undefined));

    expect(mockObserved.canPublishCatalog).toBe(false);
  });

  it("supplies the app bar layout dropdown and a pass-through wrapPlayer", async () => {
    await mount(makeBridge({ orgId: "org-a", orgRole: "member" }));

    expect(mockObserved.hasLayoutButton).toBe(true);
    expect(mockObserved.playerPassedThrough).toBe(true);
  });
});
