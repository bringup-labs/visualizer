// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * True when running inside the bringup desktop app's embedded webview (the
 * `extension` build target). The bringup host shim injects
 * `window.acquireBringupApi` before any page script runs, so its presence is
 * a reliable environment signal. In this environment extension install /
 * uninstall is fully supported via the BridgeExtensionLoader, which persists
 * through the host bridge — so marketplace operations must not be gated on
 * isDesktopApp() alone.
 */
export default function isBringupEmbedded(): boolean {
  return (
    typeof (global as { acquireBringupApi?: unknown }).acquireBringupApi === "function"
  );
}
