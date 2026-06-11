// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { BridgeClient } from "./bridge/BridgeClient";
import { OPEN_FILE_CHUNK_EVENT, OpenFileChunkAssembler, injectFileIntoApp } from "./openFileChunks";

const INJECT_RETRY_INTERVAL_MS = 250;
/** The hidden drop input lives inside Workspace; allow ~10s for the app shell to mount it. */
const INJECT_RETRY_LIMIT = 40;

/**
 * Listens for host-pushed "open with" file chunks (see {@link OPEN_FILE_CHUNK_EVENT}),
 * reassembles them into File objects, and feeds them into the app through the same
 * onDrop flow a drag-and-drop would take. Renders nothing.
 */
export function OpenFileListener(props: {
  bridge: Pick<BridgeClient, "onEvent">;
}): React.JSX.Element | undefined {
  const { bridge } = props;

  useEffect(() => {
    const assembler = new OpenFileChunkAssembler();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const inject = (file: File, attemptsLeft: number): void => {
      if (injectFileIntoApp(file)) {
        console.debug(`[open-file] injected "${file.name}" (${file.size} bytes)`);
        return;
      }
      if (attemptsLeft <= 0) {
        console.warn(`[open-file] drop input never appeared; dropping file "${file.name}"`);
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        inject(file, attemptsLeft - 1);
      }, INJECT_RETRY_INTERVAL_MS);
      timers.add(timer);
    };

    const unsubscribe = bridge.onEvent(OPEN_FILE_CHUNK_EVENT, (payload) => {
      const file = assembler.add(payload);
      if (file) {
        inject(file, INJECT_RETRY_LIMIT);
      }
    });

    return () => {
      unsubscribe();
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [bridge]);

  return undefined;
}
