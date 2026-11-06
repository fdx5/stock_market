# Neon city gateway entry enhancement

Scope: existing three community entry screens; reuses the city artwork and Neo tokens. The community feeds, home gauges and stored data are unchanged.

The camera now advances into the city. A large dimensional hexagonal gateway appears with rotating segmented rings, district identifier, cyan/violet edge lighting and framing corners. Sixty-four perspective light trails move from the gateway toward the viewer; their speed increases during the exit. The gateway expands toward the camera, the city pushes forward, a single soft cyan energy wash appears and the real page fades in. Typography has more visual weight and the gate is positioned separately for desktop/portrait/landscape. The bounded sequence lasts3.65seconds after image readiness, with the same650ms maximum image head start. Skip/Escape and reduced/minimal motion remain supported.

Canvas keeps the native devicePixelRatio, including3840x2160 output. Animation frames, resize observers and visibility listeners are released on exit. Compositor hints prepare the city and gateway before the exit transition. No video, new artwork, extra dependencies or external requests were added.

Validation: TypeScript and production Vite build; desktop1440x1000, portrait390x844 and landscape844x390 layout and actual handoff; skip/Escape, reduced/minimal motion, missing artwork, changing motion preference during entry, scroll restoration and no JS errors. Chrome157 headless muted, balanced effects, no screenshot during timing. Local development-server measurements below include cold startup and handoff. First cold desktop run has a short stall (minimum1-second46fps); the50fps minimum is therefore not achieved in every measured condition. Native resolution is maintained. These measurements do not establish physical-device performance.

```json
[
  {
    "viewport": [
      1440,
      1000
    ],
    "dpr": 1,
    "canvas": {
      "width": 1440,
      "height": 1000
    },
    "avg_fps": 53.3,
    "min_1s_fps": 46.0,
    "p95_ms": 16.8,
    "p99_ms": 133.4,
    "max_ms": 133.4,
    "errors": []
  },
  {
    "viewport": [
      390,
      844
    ],
    "dpr": 3,
    "canvas": {
      "width": 1170,
      "height": 2532
    },
    "avg_fps": 59.3,
    "min_1s_fps": 58.0,
    "p95_ms": 16.8,
    "p99_ms": 33.3,
    "max_ms": 33.3,
    "errors": []
  },
  {
    "viewport": [
      844,
      390
    ],
    "dpr": 2,
    "canvas": {
      "width": 1688,
      "height": 780
    },
    "avg_fps": 60.0,
    "min_1s_fps": 60.0,
    "p95_ms": 16.8,
    "p99_ms": 16.8,
    "max_ms": 16.8,
    "errors": []
  },
  {
    "viewport": [
      1920,
      1080
    ],
    "dpr": 2,
    "canvas": {
      "width": 3840,
      "height": 2160
    },
    "avg_fps": 59.7,
    "min_1s_fps": 59.0,
    "p95_ms": 16.8,
    "p99_ms": 17,
    "max_ms": 33.3,
    "errors": []
  }
]
```

## Production verification

Runtime1216acbde645bd4a6c5a494f4efb01434c30c9df, Render deploy dep-dbmk5bdckfvc738n1fsg, live2026-11-06T03:02:48Z (12:02:48KST). Exact /api/health commit and status=ok confirmed. All3 live community gateways and real-page handoffs passed desktop1440x1000DPR1, portrait390x844DPR3 and landscape844x390DPR2, with native canvas sizes, restored scrolling, no horizontal overflow and no JS errors. Error-level application logs since rollout were empty at03:03:23UTC. Screenshots and JSON are in tmp/impact-city/live/ and tmp/impact-city/live-result.json.
