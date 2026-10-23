// An anonymous browser identifier, never an authentication credential.
const KEY = "audience_browser_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AudienceConfig = { enabled: boolean; location_enabled: boolean; presence_enabled?: boolean };
let config: AudienceConfig | null = null;
let pending: Promise<AudienceConfig> | null = null;
let expiresAt = 0;

export function loadAudienceConfig(): Promise<AudienceConfig> {
  if (config && Date.now() < expiresAt) return Promise.resolve(config);
  if (!pending) pending = fetch("/api/activity/audience-config", { cache: "no-store", signal: AbortSignal.timeout(2000) })
    .then(async r => { if (!r.ok) throw new Error("config unavailable"); return r.json() as Promise<AudienceConfig>; })
    .then(value => { config = value; expiresAt = Date.now() + 15_000; return value; })
    .catch(() => ({ enabled: false, location_enabled: false }))
    .finally(() => { pending = null; });
  return pending;
}

export function audienceBrowserId(): string | null {
  if (!config?.enabled) return null;
  if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return null;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID.test(stored)) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch { return null; }
}
