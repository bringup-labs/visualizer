// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BridgeMessage, BridgeRequest, VIS_BRIDGE } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * API surface returned by `window.acquireBringupApi()`, injected by the bringup
 * webview host shim (APP lib/main/protocols.ts, WEBVIEW_HOST_SHIM).
 */
type BringupWebviewApi = {
  postMessage: (msg: unknown) => void;
  log?: (level: string, message: string, extras?: unknown[], scope?: string) => void;
  setState?: (state: unknown) => void;
  getState?: () => unknown;
};

declare global {
  interface Window {
    /** Injected by the bringup webview host shim; absent in plain-browser dev mode. */
    acquireBringupApi?: () => BringupWebviewApi;
  }
}

export interface BridgeTransport {
  send(msg: BridgeRequest): void;
  onMessage(cb: (msg: unknown) => void): void;
}

export type BridgeClientOptions = {
  /** Reject pending requests after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
};

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Request/response + event RPC client over a {@link BridgeTransport}.
 *
 * Outbound requests are `{ type: "request", id, method, req }`; the host answers with
 * `{ type: "response", id, ok, data | error }` and may push `{ type: "event", event, payload }`
 * at any time (theme changes, open-file chunks).
 */
export class BridgeClient {
  #transport: BridgeTransport;
  #timeoutMs: number;
  #nextId = 1;
  #pending = new Map<string, PendingRequest>();
  #eventListeners = new Map<string, Set<(payload: unknown) => void>>();

  public constructor(transport: BridgeTransport, options: BridgeClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#transport.onMessage((msg) => {
      this.#handleMessage(msg);
    });
  }

  public async request<T = unknown>(method: string, req: unknown): Promise<T> {
    const id = String(this.#nextId++);
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Bridge request "${method}" timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, {
        resolve: (data) => {
          resolve(data as T);
        },
        reject,
        timer,
      });
      this.#transport.send({ type: "request", id, method, req });
    });
  }

  /** Subscribe to host-pushed events. Returns an unsubscribe function. */
  public onEvent(event: string, cb: (payload: unknown) => void): () => void {
    let listeners = this.#eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#eventListeners.set(event, listeners);
    }
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  #handleMessage(msg: unknown): void {
    if (typeof msg !== "object" || msg == undefined) {
      return;
    }
    const message = msg as BridgeMessage;
    switch (message.type) {
      case "response": {
        const pending = this.#pending.get(message.id);
        if (!pending) {
          return;
        }
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) {
          pending.resolve(message.data);
        } else {
          pending.reject(new Error(message.error));
        }
        break;
      }
      case "event": {
        const listeners = this.#eventListeners.get(message.event);
        if (listeners) {
          for (const cb of listeners) {
            cb(message.payload);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Transport over the bringup webview host shim.
 *
 * Outbound: `acquireBringupApi().postMessage(msg)` — the shim wraps it as
 * `{ __bringupType: "from-webview", message: msg }` and forwards it over a MessagePort to the
 * renderer, which relays it to the extension host.
 *
 * Inbound: the shim receives `{ __bringupType: "to-webview", message }` on the MessagePort and
 * re-dispatches the inner message via `window.dispatchEvent(new MessageEvent("message", { data }))`,
 * so we subscribe with `window.addEventListener("message", ...)`.
 */
export function createShimTransport(): BridgeTransport {
  const acquire = typeof window !== "undefined" ? window.acquireBringupApi : undefined;
  if (typeof acquire !== "function") {
    throw new Error(
      "acquireBringupApi() is not available - the bringup webview host shim was not injected. " +
        "createShimTransport() only works inside a bringup extension webview; " +
        "use createMockTransport() for plain-browser development.",
    );
  }
  const api = acquire();
  return {
    send: (msg) => {
      api.postMessage(msg);
    },
    onMessage: (cb) => {
      window.addEventListener("message", (ev: MessageEvent) => {
        // Only accept messages re-dispatched by the bringup host shim. The shim re-emits host
        // messages with `dispatchEvent(new MessageEvent(...))`, which produces a null source and
        // an empty origin. Cross-frame postMessage calls (potential attackers) always carry a
        // non-null source and a real origin.
        if (ev.source != undefined || ev.origin !== "") {
          return;
        }
        if (ev.data == undefined) {
          return;
        }
        cb(ev.data);
      });
    },
  };
}

/**
 * In-memory transport for plain-browser development (`yarn extension:serve` without the
 * desktop app). Answers the VIS_BRIDGE methods with empty/default data.
 */
export function createMockTransport(): BridgeTransport {
  const settings = new Map<string, unknown>();
  let receive: (msg: unknown) => void = () => {};

  const handle = (request: BridgeRequest): BridgeMessage => {
    const { id, method, req } = request;
    switch (method) {
      case VIS_BRIDGE.configGetAll:
        return { type: "response", id, ok: true, data: Object.fromEntries(settings) };
      case VIS_BRIDGE.configSet: {
        const { key, value } = req as { key: string; value: unknown };
        settings.set(key, value);
        return { type: "response", id, ok: true, data: {} };
      }
      case VIS_BRIDGE.layoutsList:
      case VIS_BRIDGE.pluginsList:
        return { type: "response", id, ok: true, data: [] };
      case VIS_BRIDGE.layoutsGet:
      case VIS_BRIDGE.pluginsGet:
      case VIS_BRIDGE.pluginsGetData:
        return { type: "response", id, ok: true, data: undefined };
      case VIS_BRIDGE.layoutsPut: {
        const layout = (req as { layout?: unknown } | undefined)?.layout;
        return { type: "response", id, ok: true, data: layout ?? req };
      }
      case VIS_BRIDGE.layoutsDelete:
      case VIS_BRIDGE.layoutsImport:
      case VIS_BRIDGE.pluginsInstall:
      case VIS_BRIDGE.pluginsUninstall:
        return { type: "response", id, ok: true, data: {} };
      case VIS_BRIDGE.sessionGetOrgContext:
        // Plain-browser dev mode has no host session: behave like a signed-out
        // user so the app falls back to personal layouts only.
        return { type: "response", id, ok: true, data: undefined };
      case VIS_BRIDGE.layoutsRemoteList:
        return { type: "response", id, ok: true, data: [] };
      case VIS_BRIDGE.layoutsRemoteGet:
        return { type: "response", id, ok: true, data: undefined };
      case VIS_BRIDGE.layoutsRemoteCreate: {
        const { layoutId, name, data, permission } = req as {
          layoutId: string;
          name: string;
          data: unknown;
          permission: string;
        };
        return {
          type: "response",
          id,
          ok: true,
          data: {
            id: layoutId,
            externalId: `mock-${layoutId}`,
            name,
            data,
            permission,
            savedAt: new Date().toISOString(),
          },
        };
      }
      case VIS_BRIDGE.layoutsRemoteUpdate:
        // Dev mode has no server, so reporting success would let the sync loop
        // mark layouts `tracked` against a backend that does not exist.
        return { type: "response", id, ok: true, data: { status: "conflict" } };
      case VIS_BRIDGE.layoutsRemoteDelete:
        return { type: "response", id, ok: true, data: false };
      case VIS_BRIDGE.themeGet:
        return { type: "response", id, ok: true, data: { kind: "dark" } };
      default:
        return { type: "response", id, ok: false, error: `Unknown bridge method: ${method}` };
    }
  };

  return {
    send: (msg) => {
      const response = handle(msg);
      setTimeout(() => {
        receive(response);
      }, 0);
    },
    onMessage: (cb) => {
      receive = cb;
    },
  };
}

/**
 * Create a BridgeClient on the appropriate transport: the host shim when running inside a
 * bringup extension webview, otherwise an in-memory mock for plain-browser development.
 */
export function createBridge(): BridgeClient {
  if (typeof window !== "undefined" && typeof window.acquireBringupApi === "function") {
    return new BridgeClient(createShimTransport());
  }
  console.debug(
    "[bridge] acquireBringupApi() not found - using in-memory mock transport (browser dev mode)",
  );
  return new BridgeClient(createMockTransport());
}
