export type DeviceInfo = { platform?: string; model?: string; ipad: boolean; mobile?: boolean };
type HintNavigator = Navigator & { userAgentData?: {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (keys: string[]) => Promise<{ model?: string; platform?: string }>;
} };

let details: DeviceInfo | null = null;
let requested = false;
let pending: Promise<void> | null = null;

/** Best effort, one hint request per tab. No permission prompt or network lookup.
 * iPad's desktop UA is otherwise indistinguishable from a Mac. No identifiers,
 * screen dimensions, serial numbers or fingerprint are collected.
 */
export function deviceInfo(): DeviceInfo {
  const nav = navigator as HintNavigator;
  if (!details) details = {
    platform: (nav.userAgentData?.platform || nav.platform || "").slice(0, 40),
    mobile: nav.userAgentData?.mobile,
    ipad: /iPad/.test(nav.userAgent) || (/Mac/.test(nav.platform || "") && nav.maxTouchPoints > 1),
  };
  if (!requested) {
    requested = true;
    const hints = nav.userAgentData;
    if (hints?.getHighEntropyValues) {
      pending = Promise.resolve().then(() => hints.getHighEntropyValues!(["model", "platform"])).then(result => {
        details = { ...details!, model: (result.model || "").slice(0, 80), platform: (result.platform || details!.platform || "").slice(0, 40) };
      }).catch(() => { /* blocked/unsupported: the UA remains the source */ });
    }
  }
  return { ...details };
}

/** Capture the first view's model when available, with a bounded async wait.
 * UI rendering is never blocked; unsupported browsers take the immediate path.
 */
export async function resolveDeviceInfo(): Promise<DeviceInfo> {
  deviceInfo();
  if (pending) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, 150); })]);
    if (timer) clearTimeout(timer);
  }
  return deviceInfo();
}
