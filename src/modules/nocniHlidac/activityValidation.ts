// Client/buildVersion sanitization for the activity endpoints — lenient on
// purpose (never 400 on these two fields), mirroring nocni-hlidac's own
// client-side lib/activity/activityClient.ts. Defense-in-depth twin, same
// convention as hardcoreProfileValidation.ts's sanitizeIncomingHardcoreSnapshot
// (this endpoint is reachable by anything holding the shared bearer token,
// not just the current nocni-hlidac client code).
export const ACTIVITY_CLIENTS = ['web', 'itch', 'local-export'] as const;
export type ActivityClient = (typeof ACTIVITY_CLIENTS)[number] | 'unknown';

export function resolveActivityClient(raw: unknown): ActivityClient {
  return typeof raw === 'string' && (ACTIVITY_CLIENTS as readonly string[]).includes(raw) ? (raw as ActivityClient) : 'unknown';
}

const BUILD_VERSION_MAX_LENGTH = 64;

export function sanitizeBuildVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, BUILD_VERSION_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
