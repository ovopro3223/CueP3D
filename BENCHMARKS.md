# BENCHMARKS

Generated 2026-10-29T17:40:08.680Z — commit `a001ee0` — Chromium 156.0.8078.4

3 runs per cell, median reported (bench/src/median.ts). Goals (docs/01-design.md §3): CueP3D TTFV ≤ 500 ms and TTI ≤ 3000 ms on `3g-fast`, for every model.

`TTFV`/`TTI` are the viewer's own internal marks (`window.__cuep3dMetrics`), timed from `createViewer()`'s own construction — they exclude however long the page's JS bundle itself took to fetch/parse/execute first. `Wall TTFV`/`Wall TTI` are the same two marks timed from navigation start instead (what a real visitor's clock would show); see docs/reports/P7b-report.md for why the two differ. For CueP3D, `TTFV` is the inline poster carried by the manifest (frame 0 as an AVIF still, D-014) and `First video frame` is the first decoded frame of the AV1 proxy — the number `TTFV` reported before D-014; `Bytes before first visual` is then the manifest itself (poster included). Plain has no poster or proxy, so that column is empty for it.

## Presets

| Preset    | Download | Upload   | RTT    |
| --------- | -------- | -------- | ------ |
| `wifi`    | 30 Mbps  | 30 Mbps  | 20 ms  |
| `4g`      | 9 Mbps   | 9 Mbps   | 60 ms  |
| `3g-fast` | 1.6 Mbps | 1.6 Mbps | 150 ms |

## wifi (30 Mbps / 20 ms)

| Model       | Mode   | State    | TTFV    | Wall TTFV | First video frame | TTI     | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ------ | -------- | ------- | --------- | ----------------- | ------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain  | rendered | 2615 ms | 3200 ms   | —                 | 2615 ms | 3200 ms  | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | cuep3d | settled  | 74 ms   | 280 ms    | 132 ms            | 133 ms  | 884 ms   | 1374 ms      | 5473 ms         | 6.1 KB                    | 11.28 MB    |
| BoomBox     | plain  | rendered | 3334 ms | 4069 ms   | —                 | 3334 ms | 4069 ms  | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | cuep3d | settled  | 73 ms   | 277 ms    | 134 ms            | 135 ms  | 897 ms   | 1442 ms      | 5726 ms         | 9.7 KB                    | 11.51 MB    |
| WaterBottle | plain  | rendered | 2890 ms | 3634 ms   | —                 | 2890 ms | 3634 ms  | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | cuep3d | settled  | 74 ms   | 277 ms    | 131 ms            | 132 ms  | 883 ms   | 1432 ms      | 5709 ms         | 5.6 KB                    | 11.26 MB    |

## 4g (9 Mbps / 60 ms)

| Model       | Mode   | State    | TTFV     | Wall TTFV | First video frame | TTI      | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ------ | -------- | -------- | --------- | ----------------- | -------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain  | rendered | 7758 ms  | 8633 ms   | —                 | 7758 ms  | 8633 ms  | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | cuep3d | settled  | 125 ms   | 575 ms    | 202 ms            | 222 ms   | 1198 ms  | 1987 ms      | 13513 ms        | 6.1 KB                    | 11.28 MB    |
| BoomBox     | plain  | rendered | 10110 ms | 11101 ms  | —                 | 10110 ms | 11101 ms | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | cuep3d | settled  | 130 ms   | 580 ms    | 215 ms            | 329 ms   | 1302 ms  | 2091 ms      | 13705 ms        | 9.7 KB                    | 11.51 MB    |
| WaterBottle | plain  | rendered | 8600 ms  | 9572 ms   | —                 | 8600 ms  | 9572 ms  | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | cuep3d | settled  | 132 ms   | 604 ms    | 234 ms            | 235 ms   | 1725 ms  | 2822 ms      | 15171 ms        | 5.6 KB                    | 11.26 MB    |

## 3g-fast (1.6 Mbps / 150 ms)

| Model       | Mode   | State    | TTFV     | Wall TTFV | First video frame | TTI      | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ------ | -------- | -------- | --------- | ----------------- | -------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain  | rendered | 41698 ms | 43955 ms  | —                 | 41698 ms | 43955 ms | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | cuep3d | settled  | 247 ms   | 1830 ms   | 425 ms            | 654 ms   | 3294 ms  | 5738 ms      | 66226 ms        | 6.1 KB                    | 11.28 MB    |
| BoomBox     | plain  | rendered | 54458 ms | 56892 ms  | —                 | 54458 ms | 56892 ms | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | cuep3d | settled  | 253 ms   | 1803 ms   | 453 ms            | 1097 ms  | 3694 ms  | 6780 ms      | 67526 ms        | 9.7 KB                    | 11.51 MB    |
| WaterBottle | plain  | rendered | 46109 ms | 48569 ms  | —                 | 46109 ms | 48569 ms | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | cuep3d | settled  | 248 ms   | 1815 ms   | 419 ms            | 677 ms   | 3258 ms  | 5833 ms      | 66059 ms        | 5.6 KB                    | 11.26 MB    |
