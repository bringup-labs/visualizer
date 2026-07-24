import { SchemaRegistry } from "./schemaRegistry";

describe("SchemaRegistry", () => {
  it("decodes std_msgs/msg/String CDR (with encapsulation header)", () => {
    const reg = new SchemaRegistry();
    const entry = reg.get("std_msgs/msg/String");
    expect(entry).toBeDefined();
    // CDR_LE: header 00 01 00 00, string len 6 ("hello\0"), bytes, NUL
    const payload = new Uint8Array([
      0x00, 0x01, 0x00, 0x00,
      0x06, 0x00, 0x00, 0x00,
      0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00,
    ]);
    const msg = entry!.reader.readMessage(payload) as { data: string };
    expect(msg.data).toBe("hello");
  });

  it("resolves transitive dependencies (nested types)", () => {
    const reg = new SchemaRegistry();
    const entry = reg.get("geometry_msgs/msg/PoseStamped");
    expect(entry).toBeDefined();
    // datatypes must include the nested types for panels to introspect.
    expect(entry!.datatypes.has("geometry_msgs/msg/Pose")).toBe(true);
    expect(entry!.datatypes.has("std_msgs/msg/Header")).toBe(true);
  });

  it("returns undefined for unknown/custom types and caches lookups", () => {
    const reg = new SchemaRegistry();
    expect(reg.get("bringup_msgs/msg/MotorStatus")).toBeUndefined();
    expect(reg.get("std_msgs/msg/String")).toBe(reg.get("std_msgs/msg/String"));
  });
});
