import { Capacitor } from "@capacitor/core";

export function isAndroidApp(): boolean {
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const result = native && platform === "android";
  console.log(`[BD-CALL] isAndroidApp: native=${native}, platform=${platform}, result=${result}`);
  return result;
}
