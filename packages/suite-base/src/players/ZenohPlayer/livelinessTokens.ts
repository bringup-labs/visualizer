// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Parser for zenoh-plugin-ros2dds liveliness tokens (v1.9.0 grammar):
 *  `@/<zenoh_id>/@ros2_lv/<kind>/<ke>/<typ>[/<qos>]`
 *  with `/` replaced by `§` inside <ke> and <typ>. */

export type LivelinessEntity = {
  kind: "MP";
  /** ROS topic name, leading slash restored. */
  topic: string;
  /** zenoh key expression to subscribe to for data. */
  keyExpr: string;
  /** ROS2 type, e.g. "std_msgs/msg/String". */
  schemaName: string;
};

const SLASH_REPLACEMENT = "§";

export function parseLivelinessToken(token: string): LivelinessEntity | undefined {
  const seg = token.split("/");
  // seg: ["@", zid, "@ros2_lv", kind, ke, typ, qos?]
  if (seg.length < 6 || seg[0] !== "@" || seg[2] !== "@ros2_lv") {
    return undefined;
  }
  const kind = seg[3];
  if (kind !== "MP") {
    return undefined; // only message publishers become visualizer topics
  }
  const ke = seg[4]!.replaceAll(SLASH_REPLACEMENT, "/");
  const schemaName = seg[5]!.replaceAll(SLASH_REPLACEMENT, "/");
  if (ke.length === 0 || schemaName.length === 0) {
    return undefined;
  }
  return { kind, topic: `/${ke}`, keyExpr: ke, schemaName };
}
