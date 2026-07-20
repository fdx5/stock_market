const SESSION_KEY = "visitor_session_id";

/** One id per browser tab, persisted in sessionStorage — shared by the visitor
 * heartbeat and activity tracking so the admin dashboard can correlate "who's
 * online" with "what are they doing." */
export function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
