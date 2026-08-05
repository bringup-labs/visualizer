// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Divider, ListSubheader, Menu, MenuItem } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppBarDropdownButton } from "@lichtblick/suite-base/components/AppBar/AppBarDropdownButton";
import {
  LayoutID,
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

type LayoutGroups = {
  catalog: Layout[];
  shared: Layout[];
  personal: Layout[];
};

const byName = (a: Layout, b: Layout) => a.name.localeCompare(b.name);

const selectCurrentLayoutId = (state: LayoutState) => state.selectedLayout?.id;
const selectCurrentLayoutName = (state: LayoutState) => state.selectedLayout?.name;

/**
 * Splits layouts into the three tiers the dropdown renders: the admin-published
 * read-only catalog (ORG_READ), user-shared org layouts (ORG_WRITE), and the
 * user's own layouts (CREATOR_WRITE). Exported for testing.
 */
export function groupLayouts(layouts: readonly Layout[]): LayoutGroups {
  const catalog: Layout[] = [];
  const shared: Layout[] = [];
  const personal: Layout[] = [];

  for (const layout of layouts) {
    if (layout.permission === "ORG_READ") {
      catalog.push(layout);
    } else if (layout.permission === "ORG_WRITE") {
      shared.push(layout);
    } else {
      personal.push(layout);
    }
  }

  return {
    catalog: catalog.sort(byName),
    shared: shared.sort(byName),
    personal: personal.sort(byName),
  };
}

/**
 * App-bar dropdown for picking a layout, grouped by organization tier.
 *
 * Injected through AppContext.appBarLayoutButton by ExtensionRoot, so it needs
 * no changes to suite-base. Rendered inside the AppBar, which is inside the
 * layout providers, so its hooks resolve normally.
 */
export function OrgLayoutDropdown(): React.JSX.Element {
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const currentId = useCurrentLayoutSelector(selectCurrentLayoutId);
  const currentName = useCurrentLayoutSelector(selectCurrentLayoutName);

  // The button is the menu anchor. AppBarDropdownButton types onClick as
  // `() => void`, so the click event is not available to read currentTarget
  // from; a ref gets the same element without widening the shared component's
  // prop type.
  const buttonRef = useRef<HTMLButtonElement>(ReactNull);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<LayoutGroups>({
    catalog: [],
    shared: [],
    personal: [],
  });

  // Refresh on mount and whenever the layout manager reports a change, which
  // covers both local edits and the remote sync loop landing new org layouts.
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      layoutManager
        .getLayouts()
        .then((layouts) => {
          if (!cancelled) {
            setGroups(groupLayouts(layouts));
          }
        })
        .catch(() => {
          // A failed refresh leaves the previous list in place; the sync loop
          // retries on its own schedule.
        });
    };

    refresh();
    layoutManager.on("change", refresh);
    return () => {
      cancelled = true;
      layoutManager.off("change", refresh);
    };
  }, [layoutManager]);

  const handleSelect = useCallback(
    (id: LayoutID) => {
      setOpen(false);
      setSelectedLayoutId(id);
    },
    [setSelectedLayoutId],
  );

  // Empty tiers are dropped up front so the dividers fall between the sections
  // that actually render, rather than leaving a stray rule at the top.
  const sections = [
    { title: "Organization catalog", layouts: groups.catalog },
    { title: "Shared", layouts: groups.shared },
    { title: "Personal", layouts: groups.personal },
  ].filter((section) => section.layouts.length > 0);

  return (
    <>
      <AppBarDropdownButton
        ref={buttonRef}
        title={currentName ?? "No layout"}
        subheader="Layout"
        selected={open}
        onClick={() => {
          setOpen(true);
        }}
        data-testid="org-layout-dropdown"
      />
      <Menu
        anchorEl={buttonRef.current}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {sections.flatMap((section, index) => [
          ...(index > 0 ? [<Divider key={`${section.title}-divider`} />] : []),
          <ListSubheader key={`${section.title}-header`} disableSticky>
            {section.title}
          </ListSubheader>,
          ...section.layouts.map((layout) => (
            <MenuItem
              key={layout.id}
              selected={layout.id === currentId}
              onClick={() => {
                handleSelect(layout.id);
              }}
            >
              {layout.name}
            </MenuItem>
          )),
        ])}
      </Menu>
    </>
  );
}
