// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BridgeClient } from "./bridge/BridgeClient";

/**
 * Listens for host-pushed "open with" file events and feeds them into the player selection.
 * Stub — chunked open-with ingestion lands in a follow-up.
 */
export function OpenFileListener(_props: { bridge: BridgeClient }): React.JSX.Element | undefined {
  return undefined;
}
