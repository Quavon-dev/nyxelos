import { FallbackBackend } from "./fallback.ts";
import { NativeBridgeBackend, resolveNativeBridgePath } from "./native-bridge.ts";
import type { LocalDataBackend } from "./types.ts";

export async function createLocalDataBackend(): Promise<LocalDataBackend> {
  const preference = (process.env.NYXEL_COMPANION_BACKEND ?? "auto").toLowerCase();
  const nativeBridgePath = await resolveNativeBridgePath();

  if (preference === "fallback") return new FallbackBackend();

  if (preference === "native" && !nativeBridgePath) {
    throw new Error(
      "NYXEL_COMPANION_BACKEND=native was requested, but no native bridge executable was found.",
    );
  }

  if (nativeBridgePath) {
    return new NativeBridgeBackend(nativeBridgePath);
  }

  return new FallbackBackend();
}
