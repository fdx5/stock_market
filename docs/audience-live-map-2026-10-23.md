# Live audience map

The administrator's audience panel now includes a zoomable Leaflet/OpenStreetMap
map and Korean display labels. Existing audience records remain unchanged.

## Storage and privacy

- `audience_location_observations` is a new append-only table with indexes. Startup
  performs CREATE TABLE/INDEX IF NOT EXISTS only; no stored rows are replaced,
  updated, expired, or deleted.
- Session identifiers are HMAC pseudonyms. Location payloads, including IP-derived
  city centres and voluntarily shared device positions, use AES-256-GCM with a
  fresh nonce and authenticated record/session/source context.
- `AUDIENCE_LOCATION_KEY` is a separate random 32-byte base64url server secret.
  Preserve it across deploys. Rotating it without a preservation strategy would
  make existing encrypted history unreadable.
- Active public pages send a presence observation approximately every 30 seconds.
  Admin pages, bots, DNT/GPC and unavailable browser storage are excluded. The
  live map reads the latest observations within 120 seconds; it does not delete
  older history. At most 500 active sessions are returned per map response.
- IP markers represent estimated city centres with a conservative uncertainty
  circle of at least 25 km, rather than actual device positions.
- Device coordinates are requested only after the visitor presses the explicit
  one-time sharing button and permits browser geolocation. The disclosure says
  coordinates and accuracy are encrypted and history remains stored. The map can
  use that shared position for 15 minutes while the session remains active. It
  shows the capture time; it does not continuously follow device movement.
- Precise coordinates are returned only by the authenticated administrator API.
  No coordinates, individual identifiers, keys or IPs are logged by these modules.

## Collection and verification

Audience config is refreshed after 15 seconds instead of retaining a disabled
value until page reload. Presence provides another collection opportunity even
when the initial page-view beacon was missed. Manual audience refresh reads the
current aggregate instead of the previous stale cache result.

`AUDIENCE_DIAGNOSTICS_KEY` authorizes only
`GET /api/activity/audience-diagnostics` with `X-Audience-Diagnostics-Key`.
This operations endpoint exposes aggregate counts and readiness, never DB
credentials, individual sessions, coordinates or region rows. It performs only
the application's existing aggregate reads. It cannot log in as an administrator
or access the map's coordinates. This avoids handing DB owner credentials to AI
tools during verification. It does not technically prevent an unrestricted
operator or Render account from performing unrelated destructive actions.

## Display labels and map provider

GeoNames cities15000/KR names (CC BY 4.0) are converted to a bundled, display-only
Korean dictionary by `scripts/build_audience_place_names.py`. Country-scoped
lookups avoid translating a city using another country's names. Known Korean
province aliases and US state names have explicit labels. Unknown names retain
the source spelling; original stored text is never rewritten.

Leaflet 1.9.4 uses the standard HTTPS OpenStreetMap tile URL with attribution,
browser caching and normal referrers. It does not prefetch or bulk-download maps.
Tiles are requested by the administrator's browser, not by visitors sharing their
positions. Map tiles depend on network availability.

Validation: 30 isolated backend tests; TypeScript and production build; synthetic
admin map at 1440/1024/390/320 widths; precise/IP/unknown markers, focus/zoom, Korean
labels, no horizontal overflow; separate real-tile display inspection. Tests use
only new temporary databases and intercepted APIs, never existing DB files.
