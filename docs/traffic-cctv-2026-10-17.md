# CCTV map and drone integration — verification status

Implemented in the isolated development branch; not released as verified live video.

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

Remaining release gate: register an approved provider key, confirm actual camera
video frames progress in Chrome on the HTTPS production site, confirm city-feed
coverage, and finish performance comparison. A location popup or a generic test
video is not treated as evidence that actual CCTV video works.
