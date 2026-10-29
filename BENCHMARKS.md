# BENCHMARKS

Generated 2026-10-29T04:16:16.499Z — commit `c7d4369` — Chromium 156.0.8078.4

3 runs per cell, median reported (bench/src/median.ts). Goals (docs/01-design.md §3): Understudy TTFV ≤ 500 ms and TTI ≤ 3000 ms on `3g-fast`, for every model.

`TTFV`/`TTI` are the viewer's own internal marks (`window.__understudyMetrics`), timed from `createViewer()`'s own construction — they exclude however long the page's JS bundle itself took to fetch/parse/execute first. `Wall TTFV`/`Wall TTI` are the same two marks timed from navigation start instead (what a real visitor's clock would show); see docs/reports/P7b-report.md for why the two differ.

## Presets

| Preset    | Download | Upload   | RTT    |
| --------- | -------- | -------- | ------ |
| `wifi`    | 30 Mbps  | 30 Mbps  | 20 ms  |
| `4g`      | 9 Mbps   | 9 Mbps   | 60 ms  |
| `3g-fast` | 1.6 Mbps | 1.6 Mbps | 150 ms |

## wifi (30 Mbps / 20 ms)

| Model       | Mode       | State    | TTFV    | Wall TTFV | TTI     | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ---------- | -------- | ------- | --------- | ------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain      | rendered | 2457 ms | 2862 ms   | 2457 ms | 2862 ms  | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | understudy | settled  | 476 ms  | 807 ms    | 476 ms  | 807 ms   | 1087 ms      | 4627 ms         | 150.6 KB                  | 11.28 MB    |
| BoomBox     | plain      | rendered | 3156 ms | 3628 ms   | 3156 ms | 3628 ms  | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | understudy | settled  | 479 ms  | 791 ms    | 479 ms  | 791 ms   | 1110 ms      | 5086 ms         | 351.7 KB                  | 11.51 MB    |
| WaterBottle | plain      | rendered | 2702 ms | 3205 ms   | 2702 ms | 3205 ms  | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | understudy | settled  | 464 ms  | 776 ms    | 464 ms  | 776 ms   | 997 ms       | 4873 ms         | 172.2 KB                  | 11.26 MB    |

## 4g (9 Mbps / 60 ms)

| Model       | Mode       | State    | TTFV    | Wall TTFV | TTI     | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ---------- | -------- | ------- | --------- | ------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain      | rendered | 7611 ms | 8192 ms   | 7611 ms | 8192 ms  | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | understudy | settled  | 498 ms  | 1137 ms   | 498 ms  | 1137 ms  | 1518 ms      | 12574 ms        | 150.6 KB                  | 11.28 MB    |
| BoomBox     | plain      | rendered | 9880 ms | 10560 ms  | 9880 ms | 10560 ms | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | understudy | settled  | 547 ms  | 1180 ms   | 548 ms  | 1180 ms  | 1639 ms      | 12972 ms        | 346.5 KB                  | 11.51 MB    |
| WaterBottle | plain      | rendered | 8403 ms | 9090 ms   | 8403 ms | 9090 ms  | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | understudy | settled  | 545 ms  | 1190 ms   | 545 ms  | 1190 ms  | 1601 ms      | 12909 ms        | 172.2 KB                  | 11.26 MB    |

## 3g-fast (1.6 Mbps / 150 ms)

| Model       | Mode       | State    | TTFV     | Wall TTFV | TTI      | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |
| ----------- | ---------- | -------- | -------- | --------- | -------- | -------- | ------------ | --------------- | ------------------------- | ----------- |
| Avocado     | plain      | rendered | 41229 ms | 42673 ms  | 41229 ms | 42673 ms | —            | —               | 7.73 MB                   | 7.73 MB     |
| Avocado     | understudy | settled  | 598 ms   | 2752 ms   | 757 ms   | 2863 ms  | 4388 ms      | 63724 ms        | 38.9 KB                   | 11.17 MB    |
| BoomBox     | plain      | rendered | 53871 ms | 55437 ms  | 53871 ms | 55437 ms | —            | —               | 10.12 MB                  | 10.12 MB    |
| BoomBox     | understudy | settled  | 605 ms   | 2753 ms   | 1270 ms  | 3411 ms  | 5859 ms      | 65562 ms        | 38.9 KB                   | 11.51 MB    |
| WaterBottle | plain      | rendered | 45568 ms | 47118 ms  | 45568 ms | 47118 ms | —            | —               | 8.55 MB                   | 8.55 MB     |
| WaterBottle | understudy | settled  | 593 ms   | 2734 ms   | 848 ms   | 2952 ms  | 4582 ms      | 63843 ms        | 37.4 KB                   | 11.12 MB    |
