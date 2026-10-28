# Codec policy — references

This page backs the "Codec policy" section of the README with dated sources. It records facts and the project's decision (D-004); it is not legal advice.

## What the policy does

- Stand-in videos are AV1 in MP4; fallbacks are VP9 and AVIF (AV1 stills).
- No H.264/AVC or H.265/HEVC encoder, decoder, codec string, fixture or flag exists in the repository; `scripts/assert-free-codecs.mjs` and a source grep enforce it in CI.
- The demo GIF is a GIF (LZW patents expired in 2004), not an MP4.

## H.264 / H.265 licensing and enforcement

- AVC essential patents are licensed through Via Licensing Alliance (formed 2023 from Via Licensing and MPEG LA) and through bilateral deals; HEVC through Access Advance and Via LA pools plus bilateral deals.
- Nokia v. Amazon (filed 2023, several jurisdictions; Fire TV sales ban in Germany 2024; settled by patent agreement March 2025) — [Nokia 6-K, 2025](https://www.sec.gov/Archives/edgar/data/924613/000110465925038218/tm2513093d1_6k.htm).
- Nokia v. Acer, ASUS, Hisense (Munich and UPC, 2025) — [JUVE Patent](https://www.juve-patent.com/cases/nokia-targets-acer-asus-hisense-in-upc-munich-patent-suits/), [MLex](https://www.mlex.com/mlex/articles/2318453/nokia-sues-acer-asus-hisense-over-video-patent-infringement). Munich injunction and temporary halt of Acer/ASUS PC sales in Germany — [heise](https://www.heise.de/en/news/Nokia-patent-lawsuit-Acer-and-Asus-must-stop-PC-sales-in-Germany-11177874.html), [Tom's Hardware](https://www.tomshardware.com/laptops/acer-and-asus-halt-pc-and-laptop-sales-in-germany-amid-h-264-codec-patent-dispute-nokia-wins-patent-ruling-forcing-tech-giants-to-license-hevc-codec), [JUVE on the FRAND ruling](https://www.juve-patent.com/cases/nokia-vs-asus-and-acer-regional-court-munich-redefines-frand-rules/). Hisense settlement with royalty payments — [JUVE Patent](https://www.juve-patent.com/cases/hisense-settles-global-dispute-with-nokia-over-video-coding-patents/). English court interim-licence declarations and RAND determination — [Lewis Silkin](https://www.lewissilkin.com/insights/2025/12/19/acer-hisense-and-asus-are-successful-in-video-coding-sep-dispute-with-nokia-102ly9l).

## AV1

- Developed by the Alliance for Open Media under a royalty-free patent policy with a member cross-license and a patent-defense program (AOMedia site; verify the current member list before release).
- Browser/hardware support: Chrome, Edge, Firefox (software and hardware); Safari 17+ plays AV1 only where hardware decode exists (A17 Pro / M3 and later). WebCodecs `VideoDecoder.isConfigSupported` is probed at run time; nothing is assumed.
- Third-party assertions: Sisvel operates an AV1 patent pool (21 patent owners listed as of late 2025, claims ~50% of the finished-product market licensed) — [Sisvel, July 2025](https://www.sisvel.com/insights/sisvel-has-licensed-half-the-av1-market-while-bringing-much-needed/), [Sisvel 2025 review](https://www.sisvel.com/insights/sisvels-turbocharged-2025-in-review/), [Panasonic licence](https://sisvel.com/news/panasonic-agrees-av1-pool-licence-with-sisvel). Access Advance's video-distribution pool also lists AV1 (verify on Access Advance's site before release).
- Position of this project: AV1 is the only widely deployed codec whose own developers grant a royalty-free license to everyone; third-party claims exist and are disclosed; we do not claim zero patent risk.

## Review schedule

Re-check this page before each release and whenever a browser changes codec support. Record the check date here: 2026-10-29 (initial).
