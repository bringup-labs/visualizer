import { parseLivelinessToken } from "./livelinessTokens";

describe("parseLivelinessToken", () => {
  const zid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

  it("parses a publisher token", () => {
    const t = parseLivelinessToken(`@/${zid}/@ros2_lv/MP/chatter/std_msgs§msg§String/:1:0:0,10`);
    expect(t).toEqual({
      kind: "MP",
      topic: "/chatter",
      keyExpr: "chatter",
      schemaName: "std_msgs/msg/String",
    });
  });

  it("restores slashes in nested names", () => {
    const t = parseLivelinessToken(`@/${zid}/@ros2_lv/MP/camera§image_raw/sensor_msgs§msg§Image/K:1:0:0,5`);
    expect(t?.topic).toBe("/camera/image_raw");
    expect(t?.keyExpr).toBe("camera/image_raw");
    expect(t?.schemaName).toBe("sensor_msgs/msg/Image");
  });

  it("ignores non-publisher and malformed tokens", () => {
    expect(parseLivelinessToken(`@/${zid}/@ros2_lv/MS/cmd_vel/geometry_msgs§msg§Twist/:1:0:0,1`)).toBeUndefined();
    expect(parseLivelinessToken(`@/${zid}/@ros2_lv/SS/set_bool/std_srvs§srv§SetBool`)).toBeUndefined();
    expect(parseLivelinessToken("@/short")).toBeUndefined();
    expect(parseLivelinessToken("not/a/token")).toBeUndefined();
  });
});
