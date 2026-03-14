import {
  SaveNewLayoutParams,
  UpdateLayoutRequest,
  UpdateLayoutResponse,
} from "@lichtblick/suite-base/api/layouts/types";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import {
  ISO8601Timestamp,
  LayoutPermission,
} from "@lichtblick/suite-base/services/ILayoutStorage";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@lichtblick/suite-base/services/IRemoteLayoutStorage";

import { BagmasterAuthClient } from "./BagmasterAuthClient";

type BagmasterLayoutDto = {
  id: string;
  name: string;
  scope_kind: "user" | "org";
  permission: "CREATOR_WRITE" | "ORG_WRITE";
  tenant_id?: number | null;
  layout_data: LayoutData;
  updated_at?: string;
};

function toRemoteLayout(layout: BagmasterLayoutDto): RemoteLayout {
  return {
    id: layout.id as LayoutID,
    externalId: layout.id,
    name: layout.name,
    data: layout.layout_data,
    permission: layout.permission as LayoutPermission,
    savedAt: layout.updated_at as ISO8601Timestamp | undefined,
  };
}

export class BagmasterLayoutsAPI implements IRemoteLayoutStorage {
  public readonly workspace: string;

  public constructor(
    private readonly authClient: BagmasterAuthClient,
    private readonly activeOrgId: string | undefined,
    workspace: string,
  ) {
    this.workspace = workspace;
  }

  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    const searchParams = new URLSearchParams();
    if (this.activeOrgId) {
      searchParams.set("org_id", this.activeOrgId);
    }

    const path = `/auth/visualizer/layouts${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;
    const layouts = await this.authClient.fetchJson<BagmasterLayoutDto[]>(path);
    return layouts.map(toRemoteLayout);
  }

  public async getLayout(id: LayoutID): Promise<RemoteLayout | undefined> {
    const layout = await this.authClient.fetchJson<BagmasterLayoutDto>(
      `/auth/visualizer/layouts/${id}`,
      {},
      { interactive: true, retryOnUnauthorized: true },
    );
    return layout ? toRemoteLayout(layout) : undefined;
  }

  public async saveNewLayout(params: SaveNewLayoutParams): Promise<RemoteLayout> {
    const permission = params.permission === "ORG_READ" ? "ORG_WRITE" : params.permission;
    const isOrgLayout = permission === "ORG_WRITE";
    if (isOrgLayout && !this.activeOrgId) {
      throw new Error("Organization layouts require an active organization");
    }

    const layout = await this.authClient.fetchJson<BagmasterLayoutDto>("/auth/visualizer/layouts", {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        scope_kind: isOrgLayout ? "org" : "user",
        permission,
        tenant_id: isOrgLayout ? Number(this.activeOrgId) : undefined,
        layout_data: params.data,
      }),
    });

    return toRemoteLayout(layout);
  }

  public async updateLayout(params: UpdateLayoutRequest): Promise<UpdateLayoutResponse> {
    const permission =
      params.permission == undefined
        ? undefined
        : params.permission === "ORG_READ"
          ? "ORG_WRITE"
          : params.permission;

    const layout = await this.authClient.fetchJson<BagmasterLayoutDto>(
      `/auth/visualizer/layouts/${params.externalId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: params.name,
          permission,
          layout_data: params.data,
        }),
      },
    );

    return {
      status: "success",
      newLayout: toRemoteLayout(layout),
    };
  }

  public async deleteLayout(id: string): Promise<boolean> {
    await this.authClient.fetchJson<{ detail: string }>(
      `/auth/visualizer/layouts/${id}`,
      { method: "DELETE" },
    );
    return true;
  }
}
