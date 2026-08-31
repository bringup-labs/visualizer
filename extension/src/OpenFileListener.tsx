// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { BridgeClient } from "./bridge/BridgeClient";
import { VIS_BRIDGE } from "./bridge/types";
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
  bridge: Pick<BridgeClient, "onEvent" | "request">;
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

    // Ask only once subscribed. This component renders well after the panel is
    // created — ExtensionRoot gates it behind two bridge round-trips — and a
    // chunk that arrives with no subscriber is dropped, which strands the
    // assembler one chunk short forever and opens nothing. So the host holds
    // the file until this call rather than streaming on panel creation.
    bridge.request(VIS_BRIDGE.openFilePending, {}).catch((err: unknown) => {
      // An older host does not know the method and has nothing waiting either, so
      // this is harmless there. A timeout or a transport failure lands here too,
      // and that means a file the user asked to open never arrives - the exact
      // silence this handshake exists to end - so warn rather than bury it at
      // debug behind a cause we have not actually checked.
      console.warn(
        "[open-file] pending-file handshake failed - a file opened from the host will not appear " +
          "(harmless on an older host, which has nothing waiting)",
        err,
      );
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
