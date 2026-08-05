// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ChannelReceiver,
  Config,
  RingChannel,
  Sample,
  SampleKind,
  Session,
  Subscriber,
} from "@eclipse-zenoh/zenoh-ts";

import { debouncePromise } from "@lichtblick/den/async";
import { fromMillis, Time } from "@lichtblick/rostime";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerPresence,
  PlayerState,
  PublishPayload,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { parseLivelinessToken } from "./livelinessTokens";
import { SchemaEntry, SchemaRegistry } from "./schemaRegistry";

/** Liveliness key expression matching every ros2dds token (any zenoh id). */
const LIVELINESS_KEY_EXPR = "@/*/@ros2_lv/**";
/** Bounded receive buffer per data subscription. */
const DATA_CHANNEL_CAPACITY = 128;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

type DiscoveredTopic = { keyExpr: string; schemaName: string };

/**
 * A read-only live Player backed by a device's `zenoh-bridge-remote-api` WebSocket.
 *
 * Discovers ROS2 publishers via liveliness tokens, subscribes to the ones panels
 * request, and decodes CDR payloads using bundled common_interfaces schemas. Custom
 * (non-bundled) message types are surfaced as a per-topic warning rather than data.
 */
export default class ZenohPlayer implements Player {
  readonly #sourceId: string;
  #url: string;
  /** zenoh-ts Config endpoint string, "ws/<host>:<port>". */
  #endpoint: string;
  #id: string;
  #name: string;
  #urlState: PlayerState["urlState"];

  #listener?: (state: PlayerState) => Promise<void>;
  #session?: Session;
  #livelinessSub?: Subscriber;
  #closed = false;
  #presence: PlayerPresence = PlayerPresence.INITIALIZING;
  #alerts = new PlayerAlertManager();
  #schemas = new SchemaRegistry();

  #reconnectDelay = RECONNECT_BASE_MS;
  #reconnectTimer?: ReturnType<typeof setTimeout>;

  /** Discovered ROS2 publishers, keyed by ROS topic name. */
  #discovered = new Map<string, DiscoveredTopic>();
  /** Active data subscribers, keyed by topic name. */
  #dataSubs = new Map<string, Subscriber>();
  /** Topics whose data subscription is in flight (declareSubscriber not yet resolved). */
  #subscribing = new Set<string>();
  /** Topics panels have asked to receive. */
  #requestedTopics = new Set<string>();

  #parsedMessages: MessageEvent[] = [];
  #topicStats = new Map<string, TopicStats>();
  #totalBytes = 0;
  /** Set on the first successful connection; its absence signals "not yet connected". */
  #startTime?: Time;

  public constructor({ url, sourceId }: { url: string; sourceId: string }) {
    this.#sourceId = sourceId;
    this.#url = url;
    // zenoh-ts expects a Config locator of the form "ws/<host>:<port>".
    this.#endpoint = url.replace(/^wss?:\/\//, "ws/");
    this.#id = `${this.#sourceId}:${url}`;
    this.#name = url;
    this.#urlState = { sourceId: this.#sourceId, parameters: { url } };
    void this.#open();
  }

  #open = async (): Promise<void> => {
    if (this.#closed) {
      return;
    }
    try {
      const session = await Session.open(new Config(this.#endpoint));
      if (this.#closed) {
        void session.close().catch(() => {});
        return;
      }
      this.#session = session;
      this.#presence = PlayerPresence.PRESENT;
      this.#reconnectDelay = RECONNECT_BASE_MS;
      this.#startTime ??= fromMillis(Date.now());
      this.#alerts.removeAlert("connection");
      await this.#subscribeLiveliness(session);
      // Re-establish any subscriptions requested before/while disconnected.
      this.#resyncSubscriptions();
      this.#emitState();
    } catch (err) {
      this.#session = undefined;
      this.#alerts.addAlert("connection", {
        severity: "error",
        message: `Zenoh connection failed: ${this.#url}`,
        error: err as Error,
        tip: "Check that the zenoh remote-api WebSocket is reachable over the mesh.",
      });
      this.#scheduleReconnect();
    }
  };

  #scheduleReconnect(): void {
    if (this.#closed) {
      return;
    }
    this.#presence = PlayerPresence.RECONNECTING;
    this.#emitState();
    const delay = this.#reconnectDelay;
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, RECONNECT_MAX_MS);
    this.#reconnectTimer = setTimeout(() => void this.#open(), delay);
  }

  async #subscribeLiveliness(session: Session): Promise<void> {
    const sub = await session.liveliness().declareSubscriber(LIVELINESS_KEY_EXPR, {
      history: true,
    });
    this.#livelinessSub = sub;
    void this.#drainLiveliness(session, sub);
  }

  async #drainLiveliness(session: Session, sub: Subscriber): Promise<void> {
    const receiver = sub.receiver() as ChannelReceiver<Sample> | undefined;
    if (receiver) {
      for await (const sample of receiver) {
        if (this.#closed) {
          return;
        }
        const entity = parseLivelinessToken(sample.keyexpr().toString());
        if (!entity) {
          continue;
        }
        if (sample.kind() === SampleKind.PUT) {
          this.#discovered.set(entity.topic, {
            keyExpr: entity.keyExpr,
            schemaName: entity.schemaName,
          });
        } else {
          this.#discovered.delete(entity.topic);
          this.#unsubscribeData(entity.topic);
        }
        this.#resyncSubscriptions();
        this.#emitState();
      }
    }
    // The liveliness receiver closes only when we intentionally close the player or when the
    // session drops. If the session dropped underneath us, transition to reconnecting.
    if (!this.#closed && this.#session === session) {
      this.#alerts.addAlert("connection", {
        severity: "error",
        message: `Zenoh connection lost: ${this.#url}`,
        tip: "Attempting to reconnect over the mesh.",
      });
      this.#teardownConnection();
      this.#scheduleReconnect();
    }
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#requestedTopics = new Set(subscriptions.map((sub) => sub.topic));
    this.#resyncSubscriptions();
  }

  #resyncSubscriptions(): void {
    if (!this.#session || this.#closed) {
      return;
    }
    for (const topic of this.#requestedTopics) {
      const entity = this.#discovered.get(topic);
      if (!entity || this.#dataSubs.has(topic) || this.#subscribing.has(topic)) {
        continue;
      }
      if (!this.#schemas.get(entity.schemaName)) {
        this.#alerts.addAlert(`schema:${topic}`, {
          severity: "warn",
          message: `Unknown message type ${entity.schemaName} on ${topic} — showing no data (v1 decodes bundled common_interfaces only)`,
        });
        continue;
      }
      void this.#subscribeData(topic, entity);
    }
    for (const topic of this.#dataSubs.keys()) {
      if (!this.#requestedTopics.has(topic)) {
        this.#unsubscribeData(topic);
      }
    }
  }

  async #subscribeData(topic: string, entity: DiscoveredTopic): Promise<void> {
    const session = this.#session;
    const entry = this.#schemas.get(entity.schemaName);
    if (!session || !entry) {
      return;
    }
    this.#subscribing.add(topic);
    try {
      const sub = await session.declareSubscriber(entity.keyExpr, {
        handler: new RingChannel(DATA_CHANNEL_CAPACITY),
      });
      // The subscription may have become stale while awaiting (unsubscribed, topic removed,
      // player closed, or reconnected). Drop it if so.
      if (
        this.#closed ||
        this.#session !== session ||
        !this.#requestedTopics.has(topic) ||
        !this.#discovered.has(topic)
      ) {
        void sub.undeclare().catch(() => {});
        return;
      }
      this.#dataSubs.set(topic, sub);
      void this.#drainData(topic, entity, entry, sub);
    } catch (err) {
      this.#alerts.addAlert(`subscribe:${topic}`, {
        severity: "error",
        message: `Failed to subscribe to ${topic}`,
        error: err as Error,
      });
      this.#emitState();
    } finally {
      this.#subscribing.delete(topic);
    }
  }

  async #drainData(
    topic: string,
    entity: DiscoveredTopic,
    entry: SchemaEntry,
    sub: Subscriber,
  ): Promise<void> {
    const receiver = sub.receiver() as ChannelReceiver<Sample> | undefined;
    if (!receiver) {
      return;
    }
    for await (const sample of receiver) {
      if (this.#closed) {
        return;
      }
      const bytes = sample.payload().toBytes();
      this.#totalBytes += bytes.byteLength;
      let message: unknown;
      try {
        // The payload includes the 4-byte CDR encapsulation header, which MessageReader expects.
        message = entry.reader.readMessage(bytes);
      } catch (err) {
        this.#alerts.addAlert(`decode:${topic}`, {
          severity: "warn",
          message: `Failed to decode ${entity.schemaName} on ${topic}`,
          error: err as Error,
        });
        this.#emitState();
        continue;
      }
      this.#parsedMessages.push({
        topic,
        receiveTime: fromMillis(Date.now()),
        message,
        schemaName: entity.schemaName,
        sizeInBytes: bytes.byteLength,
      });
      const stats = new Map(this.#topicStats);
      const prev = stats.get(topic);
      stats.set(topic, { numMessages: (prev?.numMessages ?? 0) + 1 });
      this.#topicStats = stats;
      this.#emitState();
    }
  }

  #unsubscribeData(topic: string): void {
    const sub = this.#dataSubs.get(topic);
    if (sub) {
      void sub.undeclare().catch(() => {});
      this.#dataSubs.delete(topic);
    }
    if (this.#topicStats.has(topic)) {
      const stats = new Map(this.#topicStats);
      stats.delete(topic);
      this.#topicStats = stats;
    }
  }

  #teardownConnection(): void {
    for (const sub of this.#dataSubs.values()) {
      void sub.undeclare().catch(() => {});
    }
    this.#dataSubs.clear();
    this.#subscribing.clear();
    void this.#livelinessSub?.undeclare().catch(() => {});
    this.#livelinessSub = undefined;
    const session = this.#session;
    this.#session = undefined;
    void session?.close().catch(() => {});
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  #emitState = debouncePromise(() => {
    const listener = this.#listener;
    if (!listener || this.#closed) {
      return Promise.resolve();
    }

    // Before the first successful connection there is no active data to render.
    const startTime = this.#startTime;
    if (!startTime) {
      return listener({
        name: this.#name,
        presence: this.#presence,
        progress: {},
        capabilities: [],
        profile: "ros2",
        playerId: this.#id,
        alerts: this.#alerts.alerts(),
        urlState: this.#urlState,
        activeData: undefined,
      });
    }

    const topics: Topic[] = [];
    const datatypes: RosDatatypes = new Map();
    for (const [name, entity] of this.#discovered) {
      topics.push({ name, schemaName: entity.schemaName });
      const entry = this.#schemas.get(entity.schemaName);
      if (entry) {
        for (const [dtName, dt] of entry.datatypes) {
          datatypes.set(dtName, dt);
        }
      }
    }

    const messages = this.#parsedMessages;
    this.#parsedMessages = [];
    const now = fromMillis(Date.now());
    return listener({
      name: this.#name,
      presence: this.#presence,
      progress: {},
      capabilities: [],
      profile: "ros2",
      playerId: this.#id,
      alerts: this.#alerts.alerts(),
      urlState: this.#urlState,
      activeData: {
        messages,
        totalBytesReceived: this.#totalBytes,
        startTime,
        endTime: now,
        currentTime: now,
        isPlaying: true,
        speed: 1,
        lastSeekTime: 0,
        topics,
        topicStats: this.#topicStats,
        datatypes,
      },
    });
  });

  public setListener(listener: (state: PlayerState) => Promise<void>): void {
    this.#listener = listener;
    this.#emitState();
  }

  public close(): void {
    this.#closed = true;
    if (this.#reconnectTimer != undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#teardownConnection();
  }

  // Read-only live source: publishing, services, and parameters are unsupported.
  public setPublishers(_publishers: AdvertiseOptions[]): void {}
  public setParameter(): void {}
  public setGlobalVariables(): void {}
  public publish(_request: PublishPayload): void {
    throw new Error("Publishing is not supported by the Zenoh source");
  }
  public async callService(): Promise<unknown> {
    throw new Error("Service calls are not supported by the Zenoh source");
  }
  public getBatchIterator(): undefined {
    return undefined;
  }
}
