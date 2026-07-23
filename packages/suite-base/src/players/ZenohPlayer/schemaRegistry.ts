import { MessageDefinition } from "@lichtblick/message-definition";
import { ros2galactic } from "@lichtblick/rosmsg-msgs-common";
import { MessageReader } from "@lichtblick/rosmsg2-serialization";

import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

export type SchemaEntry = {
  reader: MessageReader;
  datatypes: RosDatatypes;
};

/** Convert a ROS2 interface name ("pkg/msg/Type") to the bundled
 *  rosmsg-msgs-common key format ("pkg/Type"), which omits the interface-kind
 *  segment. Names already in "pkg/Type" form pass through unchanged. */
function toBundledKey(ros2Name: string): string {
  const parts = ros2Name.split("/");
  if (parts.length === 3 && parts[1] === "msg") {
    return `${parts[0]}/${parts[2]}`;
  }
  return ros2Name;
}

/** Inverse of {@link toBundledKey}: "pkg/Type" -> "pkg/msg/Type". */
function toRos2Name(bundledKey: string): string {
  const parts = bundledKey.split("/");
  if (parts.length === 2) {
    return `${parts[0]}/msg/${parts[1]}`;
  }
  return bundledKey;
}

/** Bundled common_interfaces schemas. Custom robot types are not resolvable
 *  in v1 (no desktop->device schema fetch); callers must degrade to a
 *  per-topic warning with raw bytes.
 *
 *  The bundled `@lichtblick/rosmsg-msgs-common` definitions are keyed and
 *  cross-referenced in ROS1-style "pkg/Type" form. This registry accepts and
 *  emits ROS2 "pkg/msg/Type" names (matching liveliness-token schema names and
 *  the topic `schemaName`s the player advertises) by renaming both definition
 *  names and their complex field-type references. */
export class SchemaRegistry {
  #cache = new Map<string, SchemaEntry | undefined>();
  #defs = ros2galactic as Record<string, MessageDefinition>;

  public get(schemaName: string): SchemaEntry | undefined {
    if (this.#cache.has(schemaName)) {
      return this.#cache.get(schemaName);
    }
    const rootKey = toBundledKey(schemaName);
    if (!this.#defs[rootKey]) {
      this.#cache.set(schemaName, undefined);
      return undefined;
    }
    const ordered = this.#collect(rootKey);
    const datatypes: RosDatatypes = new Map();
    const definitions: MessageDefinition[] = [];
    for (const [bundledKey, def] of ordered) {
      const ros2 = this.#toRos2Definition(bundledKey, def);
      datatypes.set(ros2.name, ros2);
      definitions.push(ros2);
    }
    const reader = new MessageReader(definitions);
    const entry: SchemaEntry = { reader, datatypes };
    this.#cache.set(schemaName, entry);
    return entry;
  }

  /** Root first, then transitive complex-field dependencies (bundled keys). */
  #collect(rootKey: string): Array<[string, MessageDefinition]> {
    const out: Array<[string, MessageDefinition]> = [];
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name)) {
        return;
      }
      seen.add(name);
      const def = this.#defs[name];
      if (!def) {
        return;
      }
      out.push([name, def]);
      for (const field of def.definitions) {
        if (field.isComplex === true) {
          visit(field.type);
        }
      }
    };
    visit(rootKey);
    return out;
  }

  /** Rename a bundled definition and its complex field-type references into
   *  ROS2 "pkg/msg/Type" form so nested lookups in {@link MessageReader}
   *  resolve consistently and datatype keys match the topic schema names. */
  #toRos2Definition(bundledKey: string, def: MessageDefinition): MessageDefinition & { name: string } {
    return {
      name: toRos2Name(bundledKey),
      definitions: def.definitions.map((field) =>
        field.isComplex === true ? { ...field, type: toRos2Name(field.type) } : field,
      ),
    };
  }
}
