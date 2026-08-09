/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import "@testing-library/jest-dom";
import { AppContext, IAppContext } from "@lichtblick/suite-base/context/AppContext";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import * as LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import * as useConfirmModule from "@lichtblick/suite-base/hooks/useConfirm";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import LayoutRow from "./LayoutRow";

// Mocks
jest.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: jest.fn(),
}));
jest.mock("@lichtblick/suite-base/hooks/useConfirm", () => ({
  useConfirm: jest.fn(),
}));
jest.mock("./LayoutRow.style", () => ({
  StyledListItem: ({ children, secondaryAction }: any) => (
    <div data-testid="styled-list-item">
      {children}
      {secondaryAction}
    </div>
  ),
  StyledMenuItem: ({ children, disabled, ...props }: any) =>
    disabled === true ? (
      <button data-testid={props["data-testid"] ?? "styled-menu-item"} disabled>
        {children}
      </button>
    ) : (
      <button data-testid={props["data-testid"] ?? "styled-menu-item"} {...props}>
        {children}
      </button>
    ),
}));

const mockLayoutManager = {
  isOnline: true,
  supportsSharing: true,
  on: jest.fn(),
  off: jest.fn(),
};
const mockConfirm = jest.fn();
const mockConfirmModal = <div data-testid="confirm-modal" />;
(LayoutManagerContext.useLayoutManager as jest.Mock).mockReturnValue(mockLayoutManager);
(useConfirmModule.useConfirm as jest.Mock).mockReturnValue([mockConfirm, mockConfirmModal]);

const layoutId = BasicBuilder.string();
const layoutName = BasicBuilder.string();
// LayoutBuilder.permission is sampled at random from all three permissions. Pin it
// here so the ORG_READ read-only rules below never fire for the shared default layout.
const defaultLayout = LayoutBuilder.layout({
  id: layoutId as LayoutID,
  name: layoutName,
  permission: "CREATOR_WRITE",
});

const renderComponent = (props = {}, appContext: Partial<IAppContext> = {}) =>
  render(
    <AppContext.Provider value={{ wrapPlayer: (child) => child, ...appContext }}>
      <LayoutRow
        layout={defaultLayout}
        anySelectedModifiedLayouts={false}
        multiSelectedIds={[]}
        selected={false}
        onSelect={jest.fn()}
        onRename={jest.fn()}
        onDuplicate={jest.fn()}
        onDelete={jest.fn()}
        onShare={jest.fn()}
        onExport={jest.fn()}
        onOverwrite={jest.fn()}
        onRevert={jest.fn()}
        onMakePersonalCopy={jest.fn()}
        {...props}
      />
    </AppContext.Provider>,
  );

describe("LayoutRow rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Given default props, when rendered, then displays the layout name", () => {
    renderComponent();
    expect(screen.getByText(layoutName)).toBeInTheDocument();
  });

  it("Given selected=true, when rendered, then the list item is marked as selected", () => {
    renderComponent({ selected: true });
    expect(screen.getByTestId("layout-list-item")).toHaveClass("Mui-selected");
  });

  it("Given a layout with a different name, when rendered, then displays that name", () => {
    renderComponent({ layout: { ...defaultLayout, name: "Another Layout" } });
    expect(screen.getByText("Another Layout")).toBeInTheDocument();
  });

  it("Given multiSelectedIds includes layout id, when rendered, then the list item is marked as selected", () => {
    renderComponent({ multiSelectedIds: [layoutId] });
    expect(screen.getByTestId("layout-list-item")).toHaveClass("Mui-selected");
  });

  it("when menu button is clicked then menu opens and menu items are rendered", () => {
    renderComponent();
    fireEvent.click(screen.getByTestId("layout-actions"));
    expect(screen.getByTestId("rename-layout")).toBeInTheDocument();
    expect(screen.getByText("Export…")).toBeInTheDocument();
    expect(screen.getByTestId("delete-layout")).toBeInTheDocument();
  });

  it("when rename menu item is clicked then text field for editing name appears", async () => {
    renderComponent();
    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("rename-layout"));
    await waitFor(() => {
      const input = screen.getByTestId("layout-list-item").querySelector('input[type="text"]');
      expect(input).toBeInTheDocument();
    });
  });

  it("when delete menu item is clicked then confirm modal is triggered", async () => {
    mockConfirm.mockResolvedValue("ok");
    const onDelete = jest.fn();
    renderComponent({ onDelete });
    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("delete-layout"));
    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    });
  });

  it("when layout has modifications then unsaved changes header and related menu items are shown", () => {
    renderComponent({ layout: { ...defaultLayout, working: {}, syncInfo: undefined } });
    fireEvent.click(screen.getByTestId("layout-actions"));
    expect(screen.getByText("This layout has unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("Save changes")).toBeInTheDocument();
    expect(screen.getByText("Revert")).toBeInTheDocument();
  });

  it("when multi-selection is active then certain actions are disabled", () => {
    renderComponent({ multiSelectedIds: [BasicBuilder.string(), BasicBuilder.string()] });
    fireEvent.click(screen.getByTestId("layout-actions"));
    expect(screen.getByTestId("rename-layout")).toBeDisabled();
    expect(screen.getByTestId("export-layout")).toBeDisabled();
    expect(screen.getByTestId("delete-layout")).toBeEnabled();
  });

  it("Given a layout with modifications, when Revert is clicked and confirmed, then onRevert is called", async () => {
    const onRevert = jest.fn();
    // Simulate confirm dialog returning "ok"
    mockConfirm.mockResolvedValue("ok");
    renderComponent({ layout: { ...defaultLayout, working: {}, syncInfo: undefined }, onRevert });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByText("Revert"));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    });

    // Wait to ensure onRevert is called
    await waitFor(() => {
      expect(onRevert).toHaveBeenCalled();
    });
  });

  it("Given a layout with modifications, when Revert is clicked and cancelled, then onRevert is not called", async () => {
    const onRevert = jest.fn();
    // Simulate confirm dialog returning "cancel"
    mockConfirm.mockResolvedValue("cancel");
    renderComponent({ layout: { ...defaultLayout, working: {}, syncInfo: undefined }, onRevert });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByText("Revert"));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    });

    // Wait to ensure onRevert is not called
    await waitFor(() => {
      expect(onRevert).not.toHaveBeenCalled();
    });
  });

  it("Given a layout, when Rename is clicked and input is blurred, then onRename is called with the new name", async () => {
    const onRename = jest.fn();
    renderComponent({ onRename });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("rename-layout"));

    const input = await waitFor(() =>
      screen.getByTestId("layout-list-item").querySelector('input[type="text"]'),
    );
    const inputValue = BasicBuilder.string();
    fireEvent.change(input!, { target: { value: inputValue } });

    // Simulate blur event
    fireEvent.blur(input!);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: layoutId }), inputValue);
    });
  });

  // The embedded webview's iframe is sandboxed without allow-forms, so the
  // surrounding form never submits and Enter must commit on its own.
  it("Given a layout, when Rename is clicked and Enter is pressed, then onRename is called with the new name", async () => {
    const onRename = jest.fn();
    renderComponent({ onRename });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("rename-layout"));

    const input = await waitFor(() =>
      screen.getByTestId("layout-list-item").querySelector('input[type="text"]'),
    );
    const inputValue = BasicBuilder.string();
    fireEvent.change(input!, { target: { value: inputValue } });

    fireEvent.keyDown(input!, { key: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: layoutId }), inputValue);
    });
  });

  it("Given a layout being renamed, when Escape is pressed, then onRename is not called", async () => {
    const onRename = jest.fn();
    renderComponent({ onRename });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("rename-layout"));

    const input = await waitFor(() =>
      screen.getByTestId("layout-list-item").querySelector('input[type="text"]'),
    );
    fireEvent.change(input!, { target: { value: BasicBuilder.string() } });

    fireEvent.keyDown(input!, { key: "Escape" });

    await waitFor(() => {
      expect(onRename).not.toHaveBeenCalled();
    });
  });

  it("Given a shared layout, when Duplicate is clicked, then onMakePersonalCopy is called", () => {
    const onMakePersonalCopy = jest.fn();
    const sharedLayout = { ...defaultLayout, permission: "ORG_READ" as const };
    renderComponent({ layout: sharedLayout, onMakePersonalCopy });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("duplicate-layout"));

    expect(onMakePersonalCopy).toHaveBeenCalledWith(sharedLayout);
  });

  it("Given a personal layout, when Duplicate is clicked, then onDuplicate is called", () => {
    const onDuplicate = jest.fn();
    const personalLayout = {
      ...defaultLayout,
      working: undefined,
      permission: "CREATOR_WRITE",
    };
    renderComponent({ layout: personalLayout, onDuplicate });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("duplicate-layout"));

    expect(onDuplicate).toHaveBeenCalledWith(personalLayout);
  });

  it("Given a layout with modifications, when menu is opened, then duplicate option is not shown", () => {
    const layoutWithModifications = {
      ...defaultLayout,
      working: {},
      syncInfo: undefined,
      permission: "CREATOR_WRITE" as const,
    };
    renderComponent({ layout: layoutWithModifications });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("duplicate-layout")).not.toBeInTheDocument();
  });

  it("Given a shared layout, when menu is opened, then duplicate option is shown", () => {
    const sharedLayout = { ...defaultLayout, permission: "ORG_READ" as const };
    renderComponent({ layout: sharedLayout });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("duplicate-layout")).toBeInTheDocument();
  });
});

describe("LayoutRow ORG_READ enforcement", () => {
  const orgReadLayout: Layout = LayoutBuilder.layout({ permission: "ORG_READ" });

  beforeEach(() => {
    jest.clearAllMocks();
    (LayoutManagerContext.useLayoutManager as jest.Mock).mockReturnValue(mockLayoutManager);
    (useConfirmModule.useConfirm as jest.Mock).mockReturnValue([mockConfirm, mockConfirmModal]);
  });

  it("Given a read-only org layout and no publish capability, when menu is opened, then destructive actions are hidden", () => {
    renderComponent(
      { layout: orgReadLayout },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("rename-layout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-layout")).not.toBeInTheDocument();
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
  });

  // Revert only clears the local working copy — it fires no remote write and cannot
  // 403 — so it stays available. Without it a stray panel drag would leave a catalog
  // layout permanently dirty with no way back to the published version.
  it("Given a modified read-only org layout, when menu is opened, then Revert is still offered", () => {
    const modifiedCatalogLayout = LayoutBuilder.layout({
      permission: "ORG_READ",
      working: LayoutBuilder.baseline(),
      syncInfo: undefined,
    });

    renderComponent(
      { layout: modifiedCatalogLayout },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByText("Revert")).toBeInTheDocument();
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
  });

  it("Given a read-only org layout, when no host supplies capabilities, then destructive actions are hidden", () => {
    renderComponent({ layout: orgReadLayout });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("rename-layout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-layout")).not.toBeInTheDocument();
  });

  it("Given a read-only org layout, when menu is opened, then a personal copy is still offered", () => {
    renderComponent(
      { layout: orgReadLayout },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByText("Make a personal copy")).toBeInTheDocument();
    expect(screen.getByText("Export…")).toBeInTheDocument();
  });

  it("Given a catalog publisher, when menu is opened on a read-only org layout, then destructive actions are restored", () => {
    renderComponent(
      { layout: orgReadLayout },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("rename-layout")).toBeInTheDocument();
    expect(screen.getByTestId("delete-layout")).toBeInTheDocument();
    expect(screen.getByText("Save changes")).toBeInTheDocument();
  });

  it("Given a writable org layout and no publish capability, when menu is opened, then destructive actions remain", () => {
    const orgWriteLayout = LayoutBuilder.layout({ permission: "ORG_WRITE" });

    renderComponent(
      { layout: orgWriteLayout },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("rename-layout")).toBeInTheDocument();
    expect(screen.getByTestId("delete-layout")).toBeInTheDocument();
  });
});

describe("LayoutRow publish to catalog", () => {
  const orgWriteLayout: Layout = LayoutBuilder.layout({ permission: "ORG_WRITE" });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLayoutManager.isOnline = true;
    (LayoutManagerContext.useLayoutManager as jest.Mock).mockReturnValue(mockLayoutManager);
    (useConfirmModule.useConfirm as jest.Mock).mockReturnValue([mockConfirm, mockConfirmModal]);
  });

  it("Given a catalog publisher and a shared layout, when publish is clicked, then onPublishToCatalog is called", () => {
    const onPublishToCatalog = jest.fn();

    renderComponent(
      { layout: orgWriteLayout, onPublishToCatalog },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByText("Publish to organization catalog"));

    expect(onPublishToCatalog).toHaveBeenCalledWith(orgWriteLayout);
  });

  it("Given no publish capability, when menu is opened on a shared layout, then publish is hidden", () => {
    renderComponent(
      { layout: orgWriteLayout, onPublishToCatalog: jest.fn() },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("publish-layout-to-catalog")).not.toBeInTheDocument();
  });

  it("Given a personal layout, when menu is opened, then publish is hidden", () => {
    const personalLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

    renderComponent(
      { layout: personalLayout, onPublishToCatalog: jest.fn() },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("publish-layout-to-catalog")).not.toBeInTheDocument();
  });

  it("Given a layout already in the catalog, when menu is opened, then publish is hidden", () => {
    const catalogLayout = LayoutBuilder.layout({ permission: "ORG_READ" });

    renderComponent(
      { layout: catalogLayout, onPublishToCatalog: jest.fn() },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("publish-layout-to-catalog")).not.toBeInTheDocument();
  });

  it("Given no publish handler, when menu is opened on a shared layout, then publish is hidden", () => {
    renderComponent(
      { layout: orgWriteLayout },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("publish-layout-to-catalog")).not.toBeInTheDocument();
  });

  it("Given offline, when menu is opened on a shared layout, then publish is disabled", () => {
    mockLayoutManager.isOnline = false;

    renderComponent(
      { layout: orgWriteLayout, onPublishToCatalog: jest.fn() },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("publish-layout-to-catalog")).toBeDisabled();
  });

  it("Given multi-selection, when menu is opened on a shared layout, then publish is disabled", () => {
    renderComponent(
      {
        layout: orgWriteLayout,
        onPublishToCatalog: jest.fn(),
        multiSelectedIds: [BasicBuilder.string(), BasicBuilder.string()],
      },
      { orgLayoutCapabilities: { canPublishCatalog: true } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("publish-layout-to-catalog")).toBeDisabled();
  });
});

describe("LayoutRow refetch from server", () => {
  // LayoutBuilder fills unset props with defaults, so `working` has to be
  // cleared afterwards to get a layout with no unsaved changes.
  const unmodifiedOrgLayout: Layout = {
    ...LayoutBuilder.layout({ permission: "ORG_WRITE" }),
    working: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLayoutManager.isOnline = true;
    (LayoutManagerContext.useLayoutManager as jest.Mock).mockReturnValue(mockLayoutManager);
    (useConfirmModule.useConfirm as jest.Mock).mockReturnValue([mockConfirm, mockConfirmModal]);
  });

  it("Given an unmodified org layout, when refetch is clicked, then it refetches without confirming", async () => {
    const onRefetch = jest.fn();

    renderComponent({ layout: unmodifiedOrgLayout, onRefetch });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("refetch-layout"));

    await waitFor(() => {
      expect(onRefetch).toHaveBeenCalledWith(unmodifiedOrgLayout);
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("Given a read-only catalog layout, when menu is opened, then refetch is still offered", () => {
    const catalogLayout = LayoutBuilder.layout({ permission: "ORG_READ" });

    renderComponent(
      { layout: catalogLayout, onRefetch: jest.fn() },
      { orgLayoutCapabilities: { canPublishCatalog: false } },
    );

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("refetch-layout")).toBeInTheDocument();
  });

  it("Given a personal layout, when menu is opened, then refetch is hidden", () => {
    const personalLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

    renderComponent({ layout: personalLayout, onRefetch: jest.fn() });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("refetch-layout")).not.toBeInTheDocument();
  });

  it("Given no refetch handler, when menu is opened on an org layout, then refetch is hidden", () => {
    renderComponent({ layout: unmodifiedOrgLayout });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.queryByTestId("refetch-layout")).not.toBeInTheDocument();
  });

  it("Given offline, when menu is opened on an org layout, then refetch is disabled", () => {
    mockLayoutManager.isOnline = false;

    renderComponent({ layout: unmodifiedOrgLayout, onRefetch: jest.fn() });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("refetch-layout")).toBeDisabled();
  });

  it("Given multi-selection, when menu is opened on an org layout, then refetch is disabled", () => {
    renderComponent({
      layout: unmodifiedOrgLayout,
      onRefetch: jest.fn(),
      multiSelectedIds: [BasicBuilder.string(), BasicBuilder.string()],
    });

    fireEvent.click(screen.getByTestId("layout-actions"));

    expect(screen.getByTestId("refetch-layout")).toBeDisabled();
  });

  it("Given unsaved changes and a confirmed dialog, when refetch is clicked, then it refetches", async () => {
    const modifiedOrgLayout = LayoutBuilder.layout({
      permission: "ORG_WRITE",
      working: LayoutBuilder.baseline(),
    });
    const onRefetch = jest.fn();
    mockConfirm.mockResolvedValue("ok");

    renderComponent({ layout: modifiedOrgLayout, onRefetch });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("refetch-layout"));

    await waitFor(() => {
      expect(onRefetch).toHaveBeenCalledWith(modifiedOrgLayout);
    });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "danger", ok: "Refetch" }),
    );
  });

  it("Given unsaved changes and a dismissed dialog, when refetch is clicked, then nothing is refetched", async () => {
    const modifiedOrgLayout = LayoutBuilder.layout({
      permission: "ORG_WRITE",
      working: LayoutBuilder.baseline(),
    });
    const onRefetch = jest.fn();
    mockConfirm.mockResolvedValue("cancel");

    renderComponent({ layout: modifiedOrgLayout, onRefetch });

    fireEvent.click(screen.getByTestId("layout-actions"));
    fireEvent.click(screen.getByTestId("refetch-layout"));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
    });
    expect(onRefetch).not.toHaveBeenCalled();
  });
});
