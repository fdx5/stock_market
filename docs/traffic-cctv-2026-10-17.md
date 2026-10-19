# CCTV map and drone integration — verification status

## 2026-10-19 UTIC city CCTV enabled

UTIC opened the key for the Render outbound /24 ranges. The owner set the key as the
hosting secret `UTIC_CCTV_API_KEY` (also read: `UTIC_API_KEY`, `UTIC_KEY`). Every UTIC
request comes from the server: the catalogue (`/guide/cctvOpenData.do`) at most every
six hours, and one camera's player page (`/jsp/map/openDataCctvStream.jsp`) only when
its popup opens, reused for five minutes. The page's `<source>` (Seoul:
`strmu.spatic.go.kr/live/<CCTVIP>.stream/playlist.m3u8`) is relayed through the
existing opaque media references. All UTIC requests share a 0.6 s pace, a provider
50x pauses UTIC for 30 s and a failing media address for 10 s, and viewers share a
playlist fetched within the last second (UTIC blocks 5+/s on one URL and repeated 50x).
`/api/realestate/cctv/status` reports the key's variable name, catalogue size, fields,
kinds and the last resolve results, never the key or provider URLs. ITS stays paused.
The drone radar, 3D camera poles/signs and the popup (muted autoplay, reconnecting
after the provider's 60 s playback limit) use the city cameras.

## Owner-requested pause after connection investigation

Highway/national-road CCTV is now hidden and disabled. The drone does not mount
the controls or refresh timer, show connection warnings, load camera positions,
or open video popups. The backend returns an empty `disabled` result before
reading the key or connecting to ITS, including for an older open browser tab.
Keys and the adapter are retained. No database or saved-data changes are needed.

City/UTIC CCTV remains disabled. The next activation is city CCTV first, after
approval and successful real-video verification, rather than an automatic
calendar-based enablement. Its future adapter must not turn the ITS gate back on.

## 2026-10-17 emergency radar and flight-settings update

The radar initially covered only a few hundred metres at zoom 15. The nearest
playable camera in the Seongnam check was about 1.3 km away, outside that circle.
Camera marks were also tiny and could be covered by ordinary building dots.
The first received camera set now fits inside the circle automatically; manual
zoom is preserved. A camera-count / fit button brings the verified locations
back into view. Larger, screen-aligned camera icons draw above other map dots
and retain the correct click targets as the map rotates.

Brief lookup failures preserve recently verified locations for up to two minutes
within 3.3 km. Disabling CCTV clears this process-local display state. Refreshes
no longer remove all markers while waiting. Provider failure is visibly reported
and remains distinct from a successful query with no nearby cameras. UTIC city
lookups and links remain disabled pending approval.

The speed/altitude button now displays the selected values and opens a styled
modal with numeric inputs, sliders and quick presets. Settings apply immediately;
Escape, close, completion and backdrop dismissal work and return keyboard focus
to the button. Mobile numeric inputs, presets and close/complete buttons have
at least 44 px touch targets.

Validation: TypeScript/Vite build and CCTV regression checks passed. Disposable,
muted real Chrome verified radar fit, marker selection before/after rotation,
manual zoom preservation, retry/retention, disable cleanup, and settings input,
clamping, dismissal and 390×844 layout. Radar interaction checks use isolated
location fixtures over the actual 3D scene; they are not evidence of live video.
At 3840×2160 high quality, a 60 km/h flight measured minimum 1-second 37.36 FPS,
p95 33.4 ms, p99 50.1 ms, maximum 66.6 ms. The touch-context repeat measured
33.99 FPS minimum, p95 33.4 ms, p99/max 50.1 ms. Hardware: Ryzen 7 3700X,
RTX 3070, 16 logical cores. The actual 116 px touch radar also fit all fixture
locations and opened their popups correctly. Resolution was not reduced.
The all-segment 50 FPS requirement remains unmet.

Production now recognizes the configured ITS credential, but fresh catalog checks
return `connect_timeout` for both highway and national-road requests. No HTTP
authorization response is reached, so production key validity and live video
remain unverified. This external connection failure also explains an empty radar
on first load; rendering changes cannot create a provider list that was not received.
Local approved-key checks previously played actual highway video successfully.

The historical notes below describe earlier stages and are superseded by this
update where they conflict.

Implemented in the isolated development branch; not released as verified live video.

Release scope updated by the user: UTIC approval email has not arrived. Disable city
location lookups and links until approval; only video-bearing ITS highway/national-road
records can create radar markers, 3D camera signs or popup links. There are no city
JSONP requests in this release. The location decoder remains available for later work.
The frontend regression check verifies this gate and rejects non-ITS/location-only
records. TypeScript, the production build and 17 isolated backend tests pass.

Actual locations and provider names come from VWorld `LT_P_UTISCCTV` in the browser,
using the existing public domain-bound map key. This registry also contains cameras
whose video is not public. Location records do not imply that video is available.
The drone radar, terrain-anchored camera models, signs, and accessible nearby list
use the same camera identity and coordinates. Same-name cameras at different
locations remain distinct. Nearby requests, cache entries and models are bounded.

ITS highway/national-road video is implemented through a server-only adapter.
Set **ITS_CCTV_API_KEY** in the hosting service's secret environment after obtaining
an approved key from [ITS CCTV Open API](https://www.its.go.kr/opendata/opendataList?service=cctv).
`ITS_API_KEY` is also accepted. Do not put it in VITE variables, commits, chat or logs.
No database changes are required. A service restart is needed after configuring it.

City traffic video additionally requires an approved city/UTIC source. A UTIC
adapter is not represented as complete: its approved endpoint, key and registered
server IP have not been supplied. See [UTIC reference](https://www.utic.go.kr/guide/utisRefCctv.do).

Video is requested only when a popup is opened. HLS is loaded lazily, and the
player is destroyed when closed. Same-origin opaque media references keep the
API key and provider URLs off the client and support HTTP-origin media on the
HTTPS site. Manifest playlist, encryption-key and segment references are rewritten.
All upstream connections pin a validated public IP; redirects are revalidated.

Checks performed:

- VWorld returned actual camera records for Seoul and Busan.
- Official ITS `apiKey=test` sample lists returned XML despite requesting JSON;
  the adapter supports both. Two sample streams returned **HTTP 401**. No actual
  live-video frame progression has been verified. No CCTV-specific key was found
  in the local runtime or the names of local backend configuration variables.
- 12 isolated backend tests passed without app startup, a database or real keys.
  They cover absent keys, JSON/XML, invalid authorization, opaque references,
  HLS rewriting, private-address and redirect rejection, and reference expiry.
- Frontend checks passed for coordinates, malformed records, provider merging,
  distinct names/sites/directions, and list bounds.
- Muted real Chrome, 1920×1080 viewport, 3840×2160 rendering, high quality,
  Ryzen 7 3700X / RTX 3070: 160 actual nearby cameras; popup opening, Escape
  closing only the popup, and disabling models/signs passed without JS errors.
  Initial CCTV-on minimum 1-second FPS was 44.98, p95 33.3 ms, p99 33.5 ms,
  maximum 50.1 ms. The all-segment 50 FPS goal is **not** claimed. Repeated
  matrix/label updates and animated camera-sign glows were subsequently removed;
  final measurements are recorded separately in local QA output.

Repeated high-quality runs after that optimization measured CCTV-on minimum
44.25 FPS (p95 33.3 ms, p99 33.4 ms, max 66.7 ms); the two off runs measured
47.98 and 54.97 minimum FPS. Loading state varied, so these are not a controlled
proof of a fixed performance penalty, and the 50 FPS goal remains unmet.
Actual radar-marker selection was subsequently verified. The CCTV controls
now follow the radar in normal layout, avoiding overlap with zoom buttons as
the radar changes size. Material resources are explicitly released on exit.

Subsequent approved-key verification found the official HTTPS HLS redirect uses
port 8082 at cctvsec.ktict.co.kr. The proxy now permits that host/HTTPS port only.
17 isolated backend tests pass, including the redirect and arbitrary-host rejection.
Actual highway video played in the small popup in muted Chrome: 720×480 video,
time 0.89→8.43 s and frames 31→257 at unchanged 3840×2160 high scene rendering.
This used the local UI/read-only adapter and is not production verification.
Embedding the public UTIC player was also tested in Chrome: it produced an
abnormal-access warning and no video element. A wrapper popup does not remove
that restriction. See the detailed Korean [access report](cctv-video-access-2026-10-17.md).

Remaining release gate: configure the hosting secret, verify actual video on the
HTTPS production site, confirm approved city-feed coverage, and finish performance
comparison. A location popup or a generic test video is not live-CCTV evidence.
