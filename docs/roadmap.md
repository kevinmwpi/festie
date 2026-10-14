# Festie plan

Status: **the one plan for Festie**, consolidated on October 14, 2026 from the old roadmap, the release
runbook, the review of PRs #16–#20, a messaging critique, and code audits of offline use and crew
connectivity. It says **what to do next and in what order**. [`v1-architecture.md`](./v1-architecture.md)
(the contract) says **how** the app must behave, and [`release-runbook.md`](./release-runbook.md) holds the
release procedure. If this plan and the contract disagree, the contract wins until it is amended.

Steps marked **[contract]** change behaviour the contract fixes, so they need a contract amendment in the
same change. **[store build]** means the step needs a new binary and App Review; everything else is
JavaScript only. **[legal]** means the legal text and the App Privacy answers change too.

## 1. End goal

> A functional, cohesive mobile app that allows for near offline functionality and connectivity to your
> friends and organization during a hectic festival event.

Festival apps fail for the same reasons: no offline support, plans that are hard to compare, weak meetup
coordination, maps that break in crowds, and messaging that dies when the network does. Festie wins by
being an **offline-first group coordination tool**, not a feature-bloated super-app. Its differentiators:

1. **Group schedule comparison:** see conflicts and overlaps with friends instantly.
2. **Offline-first reliability:** works when cell service is overloaded or gone.
3. **Practical movement guidance:** "leave now to catch your next set" (not built yet).

Success means a crew can install Festie before the festival, build their schedules, invite each other,
see where their plans split, set meetups with a time and a totem photo, open the app with no signal and
still see everything that matters (including every friend's meetup and totem photo), and get a reminder
before the next important thing, including meetups a friend set up.

## 2. Where v1 stands (October 14, 2026)

**Built, not released.** Nothing has been submitted. The runbook's §7 checklist and the device QA
sign-off ([`qa-checklist.md`](./qa-checklist.md)) are open, nothing records that current `main` has run on
a phone since #17 added `expo-image`, and the only real festival in the catalog (Head Trip 2026) has ended
and was never verified against its source. There is no upcoming real festival yet.

How the code measures up against the end goal (from reading the code; confirm on a device in step 1.3):

| Capability | State | What a user sees with no or bad signal |
|---|---|---|
| Open the app with no signal and an expired session | Works | Cached Fests tab and an offline banner; queued writes wait. |
| Lineup, My Schedule, conflicts | Works once downloaded | A festival never downloaded looks empty ("Lineup coming soon") instead of "not downloaded yet" (step 2.3). |
| Crew members' picks and meetups | Partial | Present only for crews whose page, schedule or the map was opened online recently (step 3.2). |
| Create or delete a meetup | Works | Queued with "Waiting to sync". Editing a meetup has no UI (step 4). |
| Meetup reminders | Partial | Only the meetup's creator gets one (step 3.3). |
| Totem photos | Missing offline | "Photo unavailable right now" after a relaunch, even for photos seen before (step 3.1). |
| Map | Partial | Works offline only after a manual "Save map offline"; with no pack nothing explains the blank map (step 3.2). |
| Live location | Works, foreground only by design | Friends' pins poll every 30 s while the map is open and disappear 15 min after their last update. |
| Knowing how fresh the data is | Partial | Only friend pins and your own location sends show their age; crews, schedules, the lineup and map meetups never say when they were updated. Parked writes look like queued ones, and a rejected write shows one error and is rolled back with no record (step 3.5). |
| Friends' changes reaching you | Partial | Only on focus, foreground, reconnect or pull to refresh; the live map has no manual refresh (step 3.5). |
| Organizer schedule changes | Partial | Watched "daily"; reach phones on their next online refresh (step 3.9). |
| Messages | None | Chat is a v1 non-goal; see §5. |
| Fixing the app during a festival | Missing | No EAS Update channel is configured, so every fix waits for App Review (step 1.1). |

## 3. Decisions only the owner can make

In the order they block work:

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | The first target festival and its date | Pick one now (the watchlist suggests Countdown NYE); its date sets the deadline for steps 2 and 3. Countdown NYE's set times are expected about December 24, so at submission it may have a lineup but no times: decide whether that meets release gate 7 and which festival's set times the gate's device spot-check uses | Gate 7, step 3 |
| D2 | Keep or revert PR #19 (animated home page) | Revert: it does nothing for the end goal, App Review only needs `/privacy` and `/support`, and its looping animations have no pause control. The revert is clean today. Keeping it is cheap too, if the site is then frozen | Step 0 |
| D3 | Design authority | Keep [`design-system.md`](./design-system.md) as #16 shipped it, with Apple's HIG for anything it does not cover; contract goal 4 now points there. Going back to 40 px cards alone is a one-token change; going back to the whole `match_aistudio` look means undoing #16 screen by screen, because #17 was merged on top of it | Contract goal 4 |
| D4 | Over-the-air updates | Yes: add an EAS Update channel before the first store build (step 1.1) | Step 1 |
| D5 | Native modules in the first binary | Drop the unused `expo-sharing` (the dependency and its `app.json` plugin); `expo-symbols` is unused too but stays in the binary because `expo-router` depends on it. Decide whether reminders should be Time Sensitive (an entitlement) and whether location sharing and map polling should slow down in Low Power Mode (`expo-battery`, a native module); battery is first measured in step 2.10, after this build | Step 1 |
| D6 | Release gate 7 asks for an Android device check, but v1 is iOS-only and Android has never been built | Amend gate 7 to iOS-only: contract §7, runbook §7.2 and the QA checklist change together | Step 2.6 |
| D7 | Operator: LLC or not (L1) and EU trader status (L3) | Decide together, with the lawyer, before the legal text is regenerated | Step 2.1 |
| D8 | Licensed photos at launch | Launch with the media registry empty unless a photo is worth the review work; settle the CC 2.0–3.0 question before approving any | Step 0.3 |
| D9 | What "organization" means in the end goal: the festival organizer, a group larger than a 50-person crew, or staying organized | Decide before step 4; an organizer channel would need push or polling, and push is a non-goal | Step 4 |
| D10 | Location after sharing stops | Keep v1's rule (gone after 15 min) or add a "last seen near <stage>" label kept longer | Step 4 [contract][legal] |
| D11 | How changes reach `main` | Branch protection requiring a pull request and green CI, and a PR template asking which step a change serves and whether it needs a store build. A required approving review only works if agents open PRs from a separate GitHub account: GitHub does not let authors approve their own PRs, and every PR today comes from the owner's account. Every merge to `main` redeploys joinfestie.com; deploying the site from its own branch would decouple the two | Step 0.4 |
| D12 | Security of #17's migrations 011–014 (`suggest_festival`, the artwork bucket, `festival_artists`): #17 merged unreviewed, and this review did not cover contract goal 1 | Review them, or record that the CI `rls.sql` sections Q–T are enough. Either way refresh `legal/security-audit.md`, which omits the `suggest_festival` limit and the artwork bucket | Step 2.8 |

## 4. Steps

Agents do the parts of a step they can. Decisions in §3 and the owner's own actions (devices, App Store
Connect, the hosted Supabase project, GitHub settings, seeding or publishing festival data) stay with the
owner.

### Step 0. Clean up (now)

- **0.1** Fix the source of truth: the contract's design goal points to `design-system.md`, the README and
  `AGENTS.md` route agents to it, and the stale doc lines found in the review are corrected. *(Done with
  this plan.)* Still open: the stated reason for `refresh_token_reuse_interval = 30` and the 10 s refresh
  timeout (contract §3 and §4.1, `packages/data-access/src/config.ts`, `packages/data-access/README.md`,
  `supabase/config.toml`) is wrong, because GoTrue already recovers a lost refresh response; keep both
  values and correct the reason. Also correct the comment in
  `apps/mobile/src/providers/session-actions.ts` that says a 500, 429 or captive-portal refresh response
  signs the user out: `fetchWithTimeout` now turns those into retryable errors.
- **0.2** Decide PR #19 (D2). If reverted, revert the whole merge (`git revert -m 1 fbe8be9`): its 24 files
  depend on each other, and #16's static home page comes back unchanged.
- **0.3** Merge PR #20 (licensed-photo attribution, the corrected IP review, liability items L4 and L11)
  after three edits: US spelling ("License", "Licenses"), App Review notes trimmed back under 3,700
  bytes, and no doubled "via Wikimedia Commons" in requested credits. If #19 is reverted, also drop the
  `docs/legal/home-shots/` sentence from its IP review.
- **0.4** Turn on branch protection and add a PR template (D11).

### Step 1. Before the first store build (baked into the binary)

- **1.1** Add an EAS Update `channel` to the `preview` and `production` profiles in
  `apps/mobile/eas.json` and write the update policy into the runbook. A build made without a channel
  cannot receive updates later. Rules that go with it: bump the app `version` whenever native code or
  `Info.plist` changes (the runtime version policy is `appVersion`); never ship a `LOCAL_SCHEMA_VERSION`
  bump over the air, because the next offline launch would drop the cached festivals and crews
  (`packages/sync-engine/src/db-core.ts`).
- **1.2** Settle D5. Before building, bring the hosted project up to date, because both store profiles
  point at it: restore it if it is paused and back it up (runbook §2.1–§2.2), rotate the keys (§2.3;
  rotating a legacy key replaces the anon key every build embeds) and apply migrations 011–014
  (§2.4–§2.5; a build of current `main` cannot download festival data without them, contract §9.7 and
  §9.9). Then make the build and publish one test update to it (1.1).
- **1.3** Run that build on two iPhones before anything else is triaged: every finding in §2 comes from
  reading code.

### Step 2. Before submission (App Review and the legal text see these)

- **2.1** [legal] Disclose festival suggestions (migration 012 stores name, link, note and the account)
  in privacy policy §1, §5 and §6, `legal/data-compliance.md` §1 and §3, the App Privacy "Other User
  Content" text and the runbook §8.2 export query (liability item L11). Settle D7 first and fold in any
  L1/L3 text change, so the legal text is regenerated (`node docs/legal/generate.mjs`) and
  `TERMS_VERSION` bumped only once.
- **2.2** Stop probing Google for connectivity. NetInfo is unconfigured, so on iOS it requests
  `clients3.google.com/generate_204` about every 60 s (every 5 s after a failure); the privacy policy does
  not mention it, and reachability is judged by Google instead of Festie's backend. In
  `configureServicesOnce` (`apps/mobile/src/providers/app-providers.tsx`), call `NetInfo.configure`
  first, before `configureDataSync()`, because it drops listeners added earlier and would freeze the
  sync engine's online flag. Set `reachabilityUrl` to the Supabase URL plus `/auth/v1/health`,
  `reachabilityMethod: 'GET'`, the anon key as the `apikey` header and a `reachabilityTest` that passes
  on status 200: NetInfo's defaults send HEAD and pass only on 204, so changing the URL alone would
  report every iPhone offline. Note the probe in `legal/data-compliance.md` §3; the privacy policy
  already covers Supabase seeing IP addresses. If the probe stays on Google, disclose Google instead.
- **2.3** Fix the one confirmed bug a reviewer can hit: a festival whose bundle never downloaded shows an
  empty lineup instead of "not downloaded yet" (`getLocalFestivalBundle` in
  `packages/data-access/src/festivals.ts` returns the catalog row with empty sets).
- **2.4** Set Head Trip 2026 back to draft and publish at least one real upcoming festival with its
  `source_url` (D1, release gate 7). If it has only a lineup at submission, record in runbook §3.1
  whether that meets the gate and which festival the time spot-check uses.
- **2.5** The rest of runbook §2 (§2.6–§2.13: checks, SMTP, auth config, legacy data, functions, report
  notifications, smoke test). Move the project to a paid plan before submission, not "before launch":
  the reviewer signs in against it, and a paused free project fails review.
- **2.6** Close the remaining liability items due at submission, L2 and L9 (L1 and L3 are settled under
  D7), and decide gate 7 (D6).
- **2.7** Closing L1, L5, L6 or L8 after submission needs a new build and another review only if it
  changes native code. Legal text reaches users through the hosted pages once `docs/site` is
  republished (with `EXPO_PUBLIC_TERMS_URL` set, runbook §5.1), and a `TERMS_VERSION` bump or other
  JavaScript ships over the air under 1.1. Say so in runbook §7.3 and §9.
- **2.8** Security of migrations 011–014 (D12).
- **2.9** The rest of the runbook before submitting: demo content shifted into the review window (§3.3),
  the legal pages hosted (§4), EAS environment variables and the first-upload checks, including the
  Mapbox telemetry check (§5.1–§5.4), App Store Connect (§6), the §7.1 placeholders, and a named owner
  for the daily `reports:list` check (§8.1).
- **2.10** Make the submission build after 2.1–2.3 have landed, and run device QA on that build on two
  iPhones (a later code change means repeating the affected sections). Add the checks the checklist
  lacks: a weak network (Network Link Conditioner "Very Bad Network" and 100% loss, not just airplane
  mode), battery drain over a festival day with location sharing on, and readability at night and in
  sunlight.

### Step 3. Before the target festival (JavaScript only; ships over the air once 1.1 is in place)

Offline readiness:

- **3.1** [contract][legal] Totem photos offline: render them with `expo-image` (already in the binary)
  with a disk cache keyed by the photo path rather than the hourly signed URL, prefetch upcoming
  meetups' photos, and wipe them on sign-out, block and removal. Amend contract §4.1, which keeps signed
  URLs in memory only, and the privacy policy's photo wording.
- **3.2** One "get ready for no signal" sync instead of whatever the user happened to open. While online,
  on launch, foreground, reconnect, follow and join: download the bundles of followed and crew
  festivals, refresh every crew, restore reminders and prefetch artwork and totem photos (3.1). Show a
  readiness card: map saved for offline, crews updated, photos saved, reminders on, nothing waiting to
  sync. Offer the map download there instead of only behind "Save map offline", and say so when the map
  is not saved.
- **3.3** [contract] Remind everyone in the crew of a meetup, not only its creator
  (`apps/mobile/src/notifications/restore-reminders.ts` filters on the creator; contract §9.4 says
  "the user's own"). Reconcile on every crew refresh, not only on the crew page: add missing reminders,
  move ones whose meetup moved, and cancel ones whose meetup was deleted on another phone or hidden by a
  block. Otherwise the App Review account gets wrong-time reminders, because the demo crew's meetups
  are pushed about two hours ahead just before they start. Leave, removal and crew deletion already
  cancel by crew.
- **3.4** [contract] Stay under iOS's limit of 64 pending notifications: schedule the soonest ~60 and top
  up from the cache on every foreground. A multi-day festival spent mostly offline loses its later
  reminders today. Amend contract §9.4, which recreates reminders only when picks or crews refresh from
  the server.

Truthful, fresh crew data:

- **3.5** Show "Updated 10:42" on the crew page, crew schedule, lineup and map; add a refresh control to
  the live map; add Settings → Sync listing parked and rejected writes with Retry (the sync engine
  already exposes them).
- **3.6** Survive congested networks: run the festival bundle's selects in parallel and keep retrying
  while no bundle exists; let a crew refresh commit meetups before the slower picks download; add full
  jitter to sync retries and a random delay to reconnect-triggered work so a recovering cell is not hit
  in lockstep (`packages/sync-engine/src/sync-service.ts`); make pull to refresh on crew and map also
  flush the queue.
- **3.7** Say what is really happening: "Sharing · not sent for N min" when location sends fail, "Can't
  reach crew locations" instead of "Friends offline" when your own poll failed, and a warning before
  signing out offline that signing back in needs a connection. While a token refresh is failing, reads
  go out with the anon key, get a 401 and tell a user who is still signed in "Your session expired.
  Please sign in again.", which invites a sign-out that wipes the phone's copy: hold those requests in
  `fetchWithTimeout` (`packages/data-access/src/config.ts`) with a network-type error (not
  `TransientAuthError`, which stops location sharing), show the offline copy, and refetch on
  `TOKEN_REFRESHED`.
- **3.8** Bugs: a lost response after a totem upload deletes the photo the server kept
  (`packages/data-access/src/media.ts`); the map hides a crew whose festival is not the active one; a
  retried "Create crew" can create a duplicate (fix it in the client: after a timeout, refresh the crew
  list and show a same-named crew the user created in the last two minutes as created; a server
  idempotency key would need a migration and a contract amendment); check on a device whether
  `festivalapp://` links are tappable in Messages before the copy promises it.
- **3.9** Festival-day operations: who watches the official channels, how often (hourly during set
  hours, not daily), and how fast a moved or cancelled set reaches `festival:seed`.

### Step 4. After launch: next (each needs a contract amendment)

- **Edit a meetup.** The sync queue already supports updates (`updateMeetup`); only the UI is missing.
- **Keep a totem photo picked offline** and upload it when the meetup syncs, instead of discarding it.
- **"Text this meetup" / "I'm here" through the share sheet:** SMS often gets through when data does not.
  It sends nothing to Festie's servers, so it is not chat.
- **"Now and next" per crew member,** computed offline from their cached picks: the best stand-in for a
  live pin when phones are in pockets.
- **A standing crew rendezvous** ("if we get separated: the Ferris wheel, on the hour") with local
  reminders. This is the human version of the critique's "flash sync" and needs no radio.
- **Walk times between stages and "leave now" reminders** as local notifications (differentiator 3).
- **One request per crew refresh:** a security-definer RPC returning the crew snapshot, optionally since
  a cursor, instead of five sequential requests.
- **One last send of the latest foreground fix as the app goes to the background** (no background
  location permission or mode), and sharing with more than one crew.
- **A per-festival day-start hour** (days start at 06:00 for every festival today, which splits sunrise
  sets).
- **Contract §9.6 residual risks:** a CAPTCHA on email-code requests and invite codes that expire.
- **Universal links** only if invite drop-off turns out to be high (needs a privacy-reviewed way to
  measure it; v1 has no analytics).
- **From the old prototype, worth deciding on:** a one-tap meetup reply ("on my way"), an urgent banner
  when a meetup starts within 10 minutes, and a warning when a meetup point clashes with a set at that
  stage.

### Step 5. Later (only after the core is proven)

- **Android on Google Play:** the Data Safety form and a web page for account deletion requests.
- **Crew chat over the cloud** (its tables are locked in v1): moderation trigger, report and block for
  messages, client message ids, offline queueing, polling while open, privacy and age-rating changes.
- **Nearby messaging,** in the stages in §5.

## 5. Messaging critique: verdicts

A critique proposed fixing festival messaging with a Bluetooth mesh. Checked against Apple, Android and
standards documentation (October 2026):

| Claim or proposal | Verdict |
|---|---|
| iOS limits Bluetooth in the background | **True.** A backgrounded app loses its advertised name, its service ids move to an overflow area only iPhones scanning for them can read, and two backgrounded iPhones find each other poorly if at all. No relaunch after a force-quit. |
| Android/iOS mesh is asymmetric | **True.** Android cannot read the overflow area, so the iPhone should start connections. |
| Airwaves congest in crowds | **True in principle,** never measured at a festival. |
| Cell service drops | **True,** and v1 is already built around it. Texts often get through when data does not. |
| (a) Synchronized 30-minute "flash syncs" | **Rejected.** iOS cannot wake an app at a set time, and making every phone transmit at once concentrates the collisions it is meant to avoid. The useful version is a human rendezvous (step 4) plus jitter on retries (step 3.6). |
| (b) Protobuf, 95 → ~18 bytes | **Deferred.** iOS adverts cannot carry app data at all, and an authenticated, de-duplicated message needs at least 50–120 bytes. Bytes are not the bottleneck; round trips are. |
| (c) Delta sync with gossip and version hashes | **Adapted.** Take the cloud half now (one-request crew snapshot, step 4); gossip waits for nearby messaging. |
| (d) Adaptive scan throttling | **Adapted.** Nothing scans in v1; the same idea applies to the cloud path as retry jitter (step 3.6). A future Android scanner must respect the 5-scans-per-30-seconds limit. |
| (e) Foreground P2P + polling + Apple Multipeer | **Adapted without Multipeer.** Multipeer is Apple-only, capped at 8 peers, disconnects in the background, and Apple deprecated it in the Xcode 27 SDK in favour of the Network framework. |
| Messaging is needed before launch | **No.** Meetups, cached crew schedules, local reminders and location while open serve the goal; the gaps are in steps 3.1–3.5. |

Staged path, each stage only if the previous one is proven:

1. **Cloud first** (steps 3–4): offline readiness, meetup reminders for everyone, the SMS share fallback.
2. **Crew chat over the cloud** (step 5).
3. **Nearby spike, foreground only, crew-scoped** [contract][store build][legal]: a custom native module
   (`react-native-ble-plx` cannot talk phone to phone), signed and encrypted messages over a Bluetooth
   connection, relayed only by crew members while the app is open. Measure delivery, latency and battery
   at a real festival against cloud plus SMS.
4. **Background relay or Wi-Fi Aware,** only if stage 3 shows a real gain: Bluetooth background modes
   (justified to App Review) or Wi-Fi Aware on iOS 26+ (iPhone 12 or later, one pairing per pair of
   phones; prove Android interoperability on hardware first). Messages that never reach the server still
   need App Store guideline 1.2's filter, report and block, and 1.2 bars apps used mainly for "random or
   anonymous chat", so nearby messaging stays crew-only.

## 6. What the PR review concluded

| PR | Verdict | Why |
|---|---|---|
| #16 Apple-HIG design refresh | Keep, not reviewed | The owner asked for it. It touched 62 files and every screen with no review, so step 2.10's device QA of every screen stands in for one. It changed card radii from 40 to 26 without amending the contract; goal 4 now points to `design-system.md`. |
| #17 Schedule changes, lineups, artwork pipeline | Keep, not fully reviewed | Schedule changes and announced lineups serve the end goal, and #18–#20 build on it. It added festival suggestions without the privacy disclosures (step 2.1). The scout and watchlist tooling is large for one real festival; freeze it rather than grow it. |
| #18 Single source of truth | Keep, fixed here | Docs only and mostly accurate. Fixed: design-system reachability, the prototype wording, the slice-ownership rule, the website guardrail. |
| #19 Animated home page | Owner's call (D2), revert recommended | Isolated from the app; adds maintenance and an accessibility gap, nothing for the end goal. |
| #20 Licensed-photo attribution (open) | Merge after edits (step 0.3) | Merges cleanly, CI green, JavaScript only, closes L4 and records L11. |

Root cause: `main` has no protection, #16–#19 merged with no review, and two merged about four minutes
after opening (D11).

## 7. Guardrails

- **No web version of the app.** The website (`docs/site/`, generated by `docs/legal/generate.mjs` and
  served as static files) is a home page plus the privacy, terms and support pages: no sign-in, no app
  features, no trackers. Apart from step 0.2 and the legal-page updates in 2.1 and 3.1, website work is
  frozen until step 3 is done.
- **Every feature works offline first:** reads come from the SQLite/MMKV cache and writes go through the
  sync queue (contract §4.1–§4.2). A feature that needs a connection says so on screen.
- **Native code means a store build.** A new native module, entitlement or `Info.plist` change needs a
  version bump and App Review; it can never ship over the air.
- **No background location by default and no location history,** as in v1.
- **No analytics by default.** Adding any changes the privacy policy and the App Privacy answers.
- **New data, new review.** Anything that collects new data (movement, messages, Bluetooth) updates
  [`legal/data-compliance.md`](./legal/data-compliance.md), the privacy policy and the App Privacy answers
  in the same change, and gets a legal look first ([`legal/liability-checklist.md`](./legal/liability-checklist.md)).
- **Nearby messaging only after the core is proven,** behind a transport abstraction (cloud or nearby),
  because it brings device-specific bugs, battery drain and a large QA matrix.
- **Retries are jittered** so thousands of phones on a recovering cell do not retry together.

## 8. Which document owns what

| Topic | Owner | Others link to it instead of restating it |
|---|---|---|
| What to build next and why | This plan | README, `AGENTS.md` |
| How the app and backend must behave | [`v1-architecture.md`](./v1-architecture.md) (§9 wins) | All |
| Visual and interaction rules | [`design-system.md`](./design-system.md); tokens in `packages/ui/src/theme.ts` | Contract goal 4 |
| Release procedure and gates | [`release-runbook.md`](./release-runbook.md) | App Review notes, liability checklist |
| Verification commands | README "Verification gates" | Runbook §1.3, `AGENTS.md` |
| Device QA | [`qa-checklist.md`](./qa-checklist.md) | Runbook §7 |
| Festival data, demo, moderation commands | [`festival-data.md`](./festival-data.md) | Runbook §3 and §8 |
| Agent pipeline for festival data and artwork | [`agents/festival-pipeline.md`](./agents/festival-pipeline.md) | `AGENTS.md`, the scout skill |
| Legal promises and their evidence | `legal/*.md` (generated pages are never edited by hand) | App Privacy answers |
| Open legal items | [`legal/liability-checklist.md`](./legal/liability-checklist.md) | Runbook §7.2–§7.3 |

Known duplication to collapse when those files are next edited: the migration range "001–014" (about
eight places), the verification commands (README, runbook §1.3, contract §7), the liability items
restated by name in runbook §7.2–§7.3, and the operator's legal name (move it into
`docs/legal/values.json`). The product items in `agents/festival-pipeline.md` §8 are step 4 candidates: letting people mark artists
before set times exist, and a "set times are out" notice to followers, which without server push (a v1
non-goal) can only be a local notification raised when the app refreshes. That section should link here
instead of calling the first "the next product step".

## 9. Quality targets (not yet measured; measure in step 2.10)

| Metric | Target |
|---|---|
| Cold open to the cached home screen | < 2 seconds |
| Schedule toggle response | < 100 ms perceived |
| Crew schedule comparison, 50 members (the crew cap) | < 500 ms |
| Festival download on first launch, excluding the offline map | < 10 MB |
| Battery over a 10-hour festival day, map and sharing used normally | to be set after the first measurement |
