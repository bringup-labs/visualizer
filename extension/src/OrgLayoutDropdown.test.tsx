/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";

import { groupLayouts } from "./OrgLayoutDropdown";

// The dropdown's suite-base imports drag in react-mosaic-component, which ships
// ESM-only dependencies that the extension's jest transform does not process.
// `groupLayouts` is pure, so stubbing the hook modules keeps this test light.
// These calls are hoisted above the import above by babel-plugin-jest-hoist.
jest.mock("@lichtblick/suite-base/components/AppBar/AppBarDropdownButton", () => ({
  AppBarDropdownButton: () => null,
}));
jest.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: jest.fn(),
  useCurrentLayoutSelector: jest.fn(),
}));
jest.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: jest.fn(),
}));

describe("groupLayouts", () => {
  const catalog = { id: "1", name: "Perception Debug", permission: "ORG_READ" };
  const shared = { id: "2", name: "Drive Review", permission: "ORG_WRITE" };
  const personal = { id: "3", name: "My Layout", permission: "CREATOR_WRITE" };

  it("splits layouts into catalog, shared, and personal", () => {
    const groups = groupLayouts([personal, catalog, shared] as never);

    expect(groups.catalog.map((l) => l.id)).toEqual(["1"]);
    expect(groups.shared.map((l) => l.id)).toEqual(["2"]);
    expect(groups.personal.map((l) => l.id)).toEqual(["3"]);
  });

  it("sorts each group by name", () => {
    const a = { id: "a", name: "Zulu", permission: "ORG_READ" };
    const b = { id: "b", name: "Alpha", permission: "ORG_READ" };
    const c = { id: "c", name: "Zulu", permission: "ORG_WRITE" };
    const d = { id: "d", name: "Alpha", permission: "ORG_WRITE" };
    const e = { id: "e", name: "Zulu", permission: "CREATOR_WRITE" };
    const f = { id: "f", name: "Alpha", permission: "CREATOR_WRITE" };

    const groups = groupLayouts([a, b, c, d, e, f] as never);

    expect(groups.catalog.map((l) => l.name)).toEqual(["Alpha", "Zulu"]);
    expect(groups.shared.map((l) => l.name)).toEqual(["Alpha", "Zulu"]);
    expect(groups.personal.map((l) => l.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns empty groups for an empty list", () => {
    const groups = groupLayouts([] as never);

    expect(groups.catalog).toEqual([]);
    expect(groups.shared).toEqual([]);
    expect(groups.personal).toEqual([]);
  });

  it("keeps every layout in exactly one group", () => {
    const groups = groupLayouts([personal, catalog, shared] as never);

    expect(groups.catalog).toHaveLength(1);
    expect(groups.shared).toHaveLength(1);
    expect(groups.personal).toHaveLength(1);
  });

  it("does not mutate the input list", () => {
    const input = [
      { id: "a", name: "Zulu", permission: "ORG_READ" },
      { id: "b", name: "Alpha", permission: "ORG_READ" },
    ];

    groupLayouts(input as never);

    expect(input.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
