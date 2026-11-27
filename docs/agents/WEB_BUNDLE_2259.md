# Web bundle follow-up (#2259)

Measured at dev base `89f047f4`, using local production Expo web exports with source maps. NFR-PERF-005.

PR #2342 already enabled web-only route chunks. The remaining common chunk still contains modules shared by several routes. This change imports date-fns functions through their public subpaths rather than its runtime root barrel. Type-only imports remain unchanged.

| JavaScript | Before, bytes | After, bytes |
| --- | ---: | ---: |
| Entry, raw | 1,033,903 | 1,033,903 |
| Common, raw | 4,826,086 | 4,662,443 |
| Entry + common, raw | 5,859,989 | 5,696,346 |
| Common, Brotli quality 11 | 830,526 | 815,502 |

The raw common reduction is 163,643 bytes (3.39%). Entry + common falls 2.79%. This is not a measurement of total initial JavaScript or phone latency. Source maps change the trailing source-map reference, so equal-size entry files can have slightly different compressed sizes.

Largest groups by original source-content bytes in the baseline common source map include react-native-reanimated (668,693), date-fns (548,423), react-native-gesture-handler (489,299), Supabase auth (438,659), and the Hebrew/English module dictionaries (256,883 / 220,283). These are original source bytes, not attribution of minified bytes. Separate large chunks include Sentry, RevenueCat and PostHog; their presence in an export does not establish that they all load on the first visit.

Validation:
- New function-import guard fails against the old imports and passes after the change; existing locale-import guard passes.
- Entire mobile suite: 551 files, 4,573 tests, split into four sequential shards to fit the local execution budget.
- Mobile typecheck passes with a larger process heap; other workspace package typechecks pass sequentially. The parallel monorepo command exceeded the local execution budget, so its result is not claimed as passing.
- Mobile and other workspace package lint pass; mobile retains its existing PostImageViewerModal unused-argument warning. Architecture, SSOT links, spec IDs and Hebrew scan pass.
- Public landing and sign-in screens render in local Chrome with no uncaught JavaScript exceptions. Screenshots inspected. A loopback-only placeholder backend configuration prevents use of real accounts or data. Signed-in journeys and production behavior are not verified by this smoke.

This is a partial improvement. Keep #2259 open for further common-chunk reductions and required deployed web smoke. No native or production run was started for these local measurements.
