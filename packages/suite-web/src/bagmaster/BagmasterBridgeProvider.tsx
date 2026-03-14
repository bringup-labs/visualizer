import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CurrentLayoutLocalStorageSyncAdapter } from "@lichtblick/suite-base/components/CurrentLayoutLocalStorageSyncAdapter";
import { URLStateSyncAdapter } from "@lichtblick/suite-base/components/URLStateSyncAdapter";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  LayoutID,
  LayoutState,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import type { IAppContext } from "@lichtblick/suite-base/context/AppContext";
import CurrentUserContext, {
  CurrentUser,
  User,
} from "@lichtblick/suite-base/context/CurrentUserContext";
import { AppContext } from "@lichtblick/suite-base/context/AppContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { RemoteLayoutStorageContext } from "@lichtblick/suite-base/context/RemoteLayoutStorageContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import {
  Layout,
  layoutAppearsDeleted,
  layoutIsShared,
} from "@lichtblick/suite-base/services/ILayoutStorage";

import { BagmasterAuthClient } from "./BagmasterAuthClient";
import { BagmasterLayoutsAPI } from "./BagmasterLayoutsAPI";

type BagmasterUserResponse = {
  id: number;
  email: string;
  name: string;
};

type BagmasterOrgResponse = {
  id: number;
  name: string;
  realm_name: string;
};

type BagmasterBootstrapState = {
  user?: BagmasterUserResponse;
  organizations: BagmasterOrgResponse[];
  activeOrgId?: string;
  activeOrg?: BagmasterOrgResponse;
};

const selectedLayoutSelector = (state: LayoutState) => state.selectedLayout;

function getBagmasterUrlState() {
  const url = new URL(window.location.href);
  return {
    workspace: url.searchParams.get("workspace") ?? undefined,
    preferredLayoutId: url.searchParams.get("bm.layoutId") ?? undefined,
    orgId: url.searchParams.get("bm.orgId") ?? undefined,
    rosbagId: url.searchParams.get("bm.rosbagId") ?? undefined,
  };
}

function isBagmasterMode(): boolean {
  const { workspace } = getBagmasterUrlState();
  if (!APP_CONFIG.apiUrl || workspace) {
    return false;
  }
  return true;
}

function getClaimOrgId(authClient: BagmasterAuthClient): string | undefined {
  const claims = authClient.getClaims();
  const claimValue =
    claims.org_id ?? claims.tenant_id ?? claims.organization_id ?? claims["x-oidc-org-id"];
  return typeof claimValue === "string" ? claimValue : undefined;
}

function toCurrentUser(
  user: BagmasterUserResponse | undefined,
  activeOrg: BagmasterOrgResponse | undefined,
): CurrentUser {
  if (!user) {
    return {
      currentUser: undefined,
    };
  }

  const orgId = activeOrg ? String(activeOrg.id) : "personal";
  const orgName = activeOrg?.name ?? "Personal";
  const orgSlug = activeOrg?.realm_name ?? "personal";

  const currentUser: User = {
    id: String(user.id),
    email: user.email,
    orgId,
    orgDisplayName: orgName,
    orgSlug,
    orgPaid: activeOrg ? true : false,
    org: {
      id: orgId,
      slug: orgSlug,
      displayName: orgName,
      isEnterprise: false,
      allowsUploads: true,
      supportsEdgeSites: false,
    },
  };

  return {
    currentUser,
  };
}

function BagmasterPreferredLayoutSyncAdapter(props: {
  preferredLayoutId?: string;
}): ReactNull {
  const { preferredLayoutId } = props;
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!preferredLayoutId || appliedRef.current) {
      return;
    }
    appliedRef.current = true;

    let cancelled = false;
    void (async () => {
      const startTime = Date.now();
      while (layoutManager.isBusy() && Date.now() - startTime < 5000) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }

      const layout = await layoutManager.getLayout(preferredLayoutId as LayoutID);
      if (cancelled) {
        return;
      }

      if (layout) {
        await setSelectedLayoutId(layout.id);
        return;
      }

      enqueueSnackbar("The preferred layout could not be loaded. Showing the default layout.", {
        variant: "warning",
      });
    })().catch((error: unknown) => {
      enqueueSnackbar(`Failed to load the preferred layout. ${String(error)}`, {
        variant: "warning",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [layoutManager, preferredLayoutId, setSelectedLayoutId]);

  return ReactNull;
}

function BagmasterAppBarLayoutButton(props: {
  activeOrgId?: string;
  activeOrgName?: string;
}): React.JSX.Element {
  const { activeOrgId, activeOrgName } = props;
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const { openLayoutBrowser, sidebarActions } = useWorkspaceActions();
  const selectedLayout = useCurrentLayoutSelector(selectedLayoutSelector);

  const [layouts, setLayouts] = useState<readonly Layout[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"personal" | "org">(
    activeOrgId ? "org" : "personal",
  );

  const refreshLayouts = useCallback(async () => {
    setLoading(true);
    try {
      const nextLayouts = await layoutManager.getLayouts();
      const visibleLayouts = nextLayouts
        .filter((layout) => !layoutAppearsDeleted(layout))
        .sort((a, b) => a.name.localeCompare(b.name));
      setLayouts(visibleLayouts);
    } finally {
      setLoading(false);
    }
  }, [layoutManager]);

  useEffect(() => {
    void refreshLayouts();
    const listener = () => {
      void refreshLayouts();
    };
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, refreshLayouts]);

  useEffect(() => {
    if (!activeOrgId) {
      setScopeFilter("personal");
      return;
    }
    const currentLayout = layouts.find((layout) => layout.id === selectedLayout?.id);
    setScopeFilter(currentLayout && layoutIsShared(currentLayout) ? "org" : "personal");
  }, [activeOrgId, layouts, selectedLayout?.id]);

  const filteredLayouts = useMemo(() => {
    return layouts.filter((layout) => {
      if (scopeFilter === "org") {
        return layoutIsShared(layout);
      }
      return !layoutIsShared(layout);
    });
  }, [layouts, scopeFilter]);

  const currentLabel = selectedLayout?.name ?? "Select layout";

  return (
    <>
      <Button
        color="inherit"
        endIcon={loading ? <CircularProgress color="inherit" size={14} /> : <ArrowDropDownIcon />}
        onClick={(event) => {
          setMenuAnchor(event.currentTarget);
        }}
        size="small"
        startIcon={<DashboardCustomizeIcon fontSize="small" />}
        sx={{ borderRadius: 999, maxWidth: 280, textTransform: "none" }}
      >
        <Typography noWrap variant="body2">
          {currentLabel}
        </Typography>
      </Button>
      <Menu
        anchorEl={menuAnchor}
        onClose={() => {
          setMenuAnchor(null);
        }}
        open={menuAnchor != undefined}
      >
        <Box sx={{ display: "flex", gap: 1, px: 1.5, pb: 1, pt: 1 }}>
          <Button
            onClick={() => {
              setScopeFilter("personal");
            }}
            size="small"
            variant={scopeFilter === "personal" ? "contained" : "text"}
          >
            Personal
          </Button>
          {activeOrgId && (
            <Button
              onClick={() => {
                setScopeFilter("org");
              }}
              size="small"
              variant={scopeFilter === "org" ? "contained" : "text"}
            >
              {activeOrgName ?? "Organization"}
            </Button>
          )}
        </Box>
        <Divider />
        {filteredLayouts.length === 0 ? (
          <MenuItem disabled>No layouts in this scope</MenuItem>
        ) : (
          filteredLayouts.map((layout) => (
            <MenuItem
              key={layout.id}
              onClick={() => {
                void setSelectedLayoutId(layout.id);
                setMenuAnchor(null);
              }}
              selected={layout.id === selectedLayout?.id}
            >
              {layout.name}
            </MenuItem>
          ))
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            openLayoutBrowser();
            sidebarActions.left.setOpen(true);
            setMenuAnchor(null);
          }}
        >
          Manage layouts
        </MenuItem>
      </Menu>
    </>
  );
}

export default function BagmasterBridgeProvider(
  props: React.PropsWithChildren,
): React.JSX.Element {
  const enabled = useMemo(() => isBagmasterMode(), []);
  const bagmasterUrlState = useMemo(() => getBagmasterUrlState(), []);
  const authClient = useMemo(() => new BagmasterAuthClient(), []);
  const [authState, setAuthState] = useState(authClient.getState());
  const [bootstrapState, setBootstrapState] = useState<BagmasterBootstrapState>({
    organizations: [],
    user: undefined,
    activeOrgId: undefined,
    activeOrg: undefined,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setAuthState(authClient.getState());
    return authClient.subscribe(() => {
      setAuthState(authClient.getState());
    });
  }, [authClient, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void authClient.initialize(true).catch((error: unknown) => {
      enqueueSnackbar(`Failed to initialize Bagmaster sign-in. ${String(error)}`, {
        variant: "error",
      });
    });
  }, [authClient, enabled]);

  useEffect(() => {
    if (!enabled || !authState.authenticated) {
      setBootstrapState({
        organizations: [],
        user: undefined,
        activeOrgId: undefined,
        activeOrg: undefined,
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      const [user, organizations] = await Promise.all([
        authClient.fetchJson<BagmasterUserResponse>("/auth/user/me", {}, { interactive: false }),
        authClient.fetchJson<BagmasterOrgResponse[]>("/auth/org", {}, { interactive: false }),
      ]);
      if (cancelled) {
        return;
      }

      const requestedOrgId = bagmasterUrlState.orgId ?? getClaimOrgId(authClient) ?? undefined;
      const activeOrg = organizations.find((org) => String(org.id) === requestedOrgId);
      const activeOrgId = activeOrg ? String(activeOrg.id) : undefined;

      setBootstrapState({
        user,
        organizations,
        activeOrgId,
        activeOrg,
      });
    })().catch((error: unknown) => {
      enqueueSnackbar(`Failed to load Bagmaster user context. ${String(error)}`, {
        variant: "warning",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authClient, authState.authenticated, bagmasterUrlState.orgId, enabled]);

  const currentUser = useMemo(() => {
    const value = toCurrentUser(bootstrapState.user, bootstrapState.activeOrg);
    value.signIn = () => {
      void authClient.startSignIn();
    };
    value.signOut = async () => {
      await authClient.signOut();
    };
    return value;
  }, [authClient, bootstrapState.activeOrg, bootstrapState.user]);

  const remoteLayoutStorage = useMemo(() => {
    if (!enabled || !authState.authenticated) {
      return undefined;
    }
    const activeOrgId = bootstrapState.activeOrgId ?? bagmasterUrlState.orgId ?? getClaimOrgId(authClient);
    return new BagmasterLayoutsAPI(
      authClient,
      activeOrgId,
      `bagmaster:${bootstrapState.user?.id ?? "session"}:${activeOrgId ?? "personal"}`,
    );
  }, [
    authClient,
    authState.authenticated,
    bagmasterUrlState.orgId,
    bootstrapState.activeOrgId,
    bootstrapState.user?.id,
    enabled,
  ]);

  const appContextValue = useMemo<IAppContext>(
    () => ({
      appBarLayoutButton: enabled ? (
        <BagmasterAppBarLayoutButton
          activeOrgId={bootstrapState.activeOrgId}
          activeOrgName={bootstrapState.activeOrg?.name}
        />
      ) : undefined,
      layoutBrowser: undefined,
      syncAdapters: enabled
        ? [
            <URLStateSyncAdapter key="url-state-sync" />,
            <CurrentLayoutLocalStorageSyncAdapter key="layout-local-sync" />,
            <BagmasterPreferredLayoutSyncAdapter
              key="bagmaster-preferred-layout"
              preferredLayoutId={bagmasterUrlState.preferredLayoutId}
            />,
          ]
        : undefined,
      wrapPlayer: (child) => child,
    }),
    [
      bagmasterUrlState.preferredLayoutId,
      bootstrapState.activeOrg?.name,
      bootstrapState.activeOrgId,
      enabled,
    ],
  );

  if (!enabled) {
    return <>{props.children}</>;
  }

  return (
    <CurrentUserContext.Provider value={currentUser}>
      <AppContext.Provider value={appContextValue}>
        <RemoteLayoutStorageContext.Provider value={remoteLayoutStorage}>
          {props.children}
        </RemoteLayoutStorageContext.Provider>
      </AppContext.Provider>
    </CurrentUserContext.Provider>
  );
}
