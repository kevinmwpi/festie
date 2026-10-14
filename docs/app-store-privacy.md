# App Store Connect: App Privacy, age rating, export compliance

The answers to give in App Store Connect for Festie v1, worked out from the code. Release gate 7 in
[`v1-architecture.md`](./v1-architecture.md) §7 requires the submitted answers to match this page. If the
code changes what is collected, update this page, [`legal/privacy-policy.md`](./legal/privacy-policy.md)
and [`legal/data-compliance.md`](./legal/data-compliance.md) together.

Apple's definitions: data is **collected** when it leaves the device in a way that we or a partner can
access longer than needed to answer the request in real time. **Linked to the user** means tied to the
account or identity. **Tracking** means linking our data with other companies' data for advertising, or
sharing it with data brokers. Festie does none of the latter.

## 1. Data collection: "Yes, we collect data from this app"

### Tracking

**Does this app track?** No. There is no advertising SDK, no IDFA access and no App Tracking Transparency
prompt; nothing is shared with data brokers. (`apps/mobile/package.json` has no analytics, attribution or
ads dependency; `expo-insights` was removed in v1.)

### Data types to declare

| App Store category → type | What it is in Festie | Linked to user | Tracking | Purposes |
|---|---|---|---|---|
| Contact Info → **Email Address** | Sign-in email (Supabase Auth, `public.users.email`) | Yes | No | App Functionality |
| Contact Info → **Name** | Display name, 1–40 chars, shown to crews (may be a real name) | Yes | No | App Functionality |
| Location → **Precise Location** | Live location while sharing with a crew (`location_shares`: lat, lng, accuracy, heading), plus optional meetup pins; and Mapbox telemetry location events, only after the user opts in from the map's (i) menu (see "Mapbox telemetry" below) | Yes | No | App Functionality, Analytics |
| Location → **Coarse Location** | Mapbox telemetry location events when the user has opted in (see "Mapbox telemetry" below) and allowed only approximate location | No | No | Analytics |
| User Content → **Photos or Videos** | Totem photos (JPEG, metadata stripped) in the private `totems` bucket | Yes | No | App Functionality |
| User Content → **Other User Content** | Crew names, meetup titles/notes, festival follows, set picks, reports (reason, details, snapshot) and blocks | Yes | No | App Functionality |
| Identifiers → **User ID** | Account UUIDs (`auth.users.id`, `public.users.id`) used by the server | Yes | No | App Functionality |
| Identifiers → **Device ID** | Random installation ids: `EAS-Client-ID`, which `expo-updates` sends to Expo's update service on launch, and the anonymous per-install id the Mapbox SDK sends with its map-load (billing) events, which the telemetry opt-out does not turn off | No | No | App Functionality, Analytics |

Notes on the choices:

- **Precise Location**: the app requests "When In Use" only; there is no background mode and no
  `NSLocationAlways*` key (`apps/mobile/app.json` expo-location plugin). The user's own blue dot on the
  map is rendered on device and never uploaded by Festie. Analytics is declared for Mapbox's opt-in
  telemetry: Mapbox does not link it to the account, but App Store Connect takes one "linked" answer per
  data type, and Festie's own sharing is linked.
- **Coarse Location**: Festie itself never sends coarse location separately. It is declared only for
  Mapbox's opt-in telemetry, which gets approximate fixes when the user allowed only approximate
  location. The Mapbox Maps privacy manifest declares Precise Location, Coarse Location and User ID, all
  not linked, for App Functionality and Analytics
  ([`PrivacyInfo.xcprivacy` at v11.18.2](https://github.com/mapbox/mapbox-maps-ios/blob/v11.18.2/Sources/MapboxMaps/PrivacyInfo.xcprivacy)).
- **Device ID**: `expo-updates` (`updates.url` in `apps/mobile/app.json`) adds `EAS-Client-ID`, a
  per-install UUID created by `expo-eas-client`, to update requests
  (`node_modules/expo-updates/ios/EXUpdates/AppLoader/FileDownloader.swift`); Expo also uses it to count
  update installs in the EAS dashboard. The Mapbox Maps SDK counts monthly active installations for
  billing with an anonymous per-install identifier; Mapbox's own privacy manifest lists Device ID (App
  Functionality, optionally Analytics). Neither id is connected to the account. Analytics is declared as
  a purpose because both vendors count installations with them; declaring it is the conservative answer.
  The native pods are not installed in this repository, so reconcile this row with Xcode's privacy report
  of the first production build ([`release-runbook.md`](./release-runbook.md) §5.4). If you disable EAS
  Update for v1 (`"updates": { "enabled": false }`), drop Expo from this row and the matching sentence in
  the privacy policy.
- **Other User Content** also covers reports: a report stores the reporter's account id, so it is linked.
- **Name**: declared conservatively because users often type their real name. If you decide display
  names are pseudonymous handles you may argue otherwise, but declaring it is the safe answer.

### Data types to leave unchecked (verified not collected)

| Type | Why not |
|---|---|
| Phone Number, Physical Address, Other Contact Info | Never asked for |
| Health, Fitness, Financial Info, Sensitive Info | Not part of the app; no payments or purchases |
| Contacts | No contacts permission or API use |
| Emails or Text Messages | Chat was removed in v1 (`chat_messages` is locked: RLS on, no grants) |
| Audio Data | No microphone use: `microphonePermission: false`, Android `RECORD_AUDIO` blocked |
| Gameplay Content | Not a game |
| Customer Support | No in-app support form; support is a `mailto:` link that opens the user's mail app outside Festie |
| Browsing History, Search History | None recorded |
| Purchases | None |
| Product Interaction, Advertising Data, Other Usage Data | No analytics SDK; nothing records taps or screens |
| Crash Data, Performance Data, Other Diagnostic Data | No crash-reporting SDK (Apple's own opt-in crash reports are Apple's, not ours) |
| Other Data Types | Nothing else leaves the device |

Server-side technical data (IP addresses in Supabase Auth sign-in logs and sessions, kept at most 90
days or until the session ends; IP-keyed rate-limit records written
whenever a device enters a sign-in code that Supabase Auth rejects, because the app then tries the
`demo-login` function, which records the caller's IP before it compares the email; deleted about 24 h
after creation; Mapbox tile requests sent directly by the device) is used only to serve and secure
requests and is not used to identify or profile users, so it is not declared as a data type. It is
disclosed in the privacy policy.

### Mapbox telemetry: off unless the user opts in, re-checked on every release build

Apart from the opt-in below, these answers assume the Mapbox SDK sends no telemetry beyond its billing
events. The app turns the optional telemetry off with `Mapbox.setTelemetryEnabled(false)` at startup
(`apps/mobile/src/providers/app-providers.tsx`). On iOS `@rnmapbox/maps` 10.3.0 implements that by writing
the `MGLMapboxMetricsEnabled` user default (`node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXModule.swift`;
Android calls the SDK's telemetry API). Mapbox Maps SDK 11.18.2, the version `app.json` pins, still honours
that key: its `EventsManager` registers it with a default of `true`, observes it with
`[.initial, .new]` and passes every value to `TelemetryUtils.setEventsCollectionStateForEnableCollection`
([`EventsManager.swift` at v11.18.2](https://github.com/mapbox/mapbox-maps-ios/blob/v11.18.2/Sources/MapboxMaps/Foundation/Events/EventsManager.swift)). The SDK keeps sending its turnstile and map-load (billing)
events with the per-install id after the opt-out ([mapbox-maps-ios#1964](https://github.com/mapbox/mapbox-maps-ios/issues/1964)); they are declared as
Device ID above.

**User opt-in.** Mapbox's terms require the map's attribution, so the (i) button stays on the map
(`apps/mobile/app/(tabs)/map/index.tsx` only moves it). On iOS its menu always includes "Mapbox Telemetry",
whose "Participate" choice writes `MGLMapboxMetricsEnabled = true`, the same user default
([`AttributionMenu.swift` at v11.18.2](https://github.com/mapbox/mapbox-maps-ios/blob/v11.18.2/Sources/MapboxMaps/Attribution/AttributionMenu.swift)).
`EventsManager` applies the change at once, so from then on Mapbox collects its telemetry (including
location events) until the app process ends. Festie calls `setTelemetryEnabled(false)` once per launch,
so the next cold start turns telemetry off again; switching apps does not. Apple's optional-disclosure
exemption does not cover this (the data is not entered by the user in a form each time), so it is
declared above: Analytics on Precise Location and a Coarse Location row. The privacy policy (§2 and the
Mapbox entry in §4) and [`legal/data-compliance.md`](./legal/data-compliance.md) describe the opt-in. If
the app ever keeps the user's choice across launches (for example by applying the off default only on
first launch), update those three places.

This rests on the SDK source, not on observed traffic, so the traffic check in
[`release-runbook.md`](./release-runbook.md) §5.4 step 4 still has to pass on the build you submit. Read
`EventsManager.swift` again whenever `RNMapboxMapsVersion` or `@rnmapbox/maps` changes. If the check fails
and the SDK's own opt-out cannot be wired in, the Location rows above already carry the Analytics
purpose, but add anything else Mapbox collects to the table above, and update the privacy policy and
[`legal/data-compliance.md`](./legal/data-compliance.md) to say telemetry is always on before answering
App Privacy.

### Third-party SDK privacy manifests

The App Privacy answers must also cover data collected by SDKs. Festie's native SDKs with a network
component are Mapbox Maps (telemetry off unless the user opts in, see above; its turnstile and map-load
billing events with the per-install id are still sent, Device ID above), `expo-updates` (Device ID above) and Supabase JS (talks only to
our own project). After the first production build is processed, check the email from App Store Connect
for ITMS-91053 (missing privacy manifest reasons) and other warnings, and fix them before submission.
Then generate Xcode's privacy report for that build and reconcile the collected data types it lists with
the table above (see [`release-runbook.md`](./release-runbook.md) §5.4).

## 2. Privacy policy and URLs (App Store Connect → App Information / App Privacy)

| Field | Value |
|---|---|
| Privacy Policy URL (required) | `__PRIVACY_POLICY_URL__`: the hosted `docs/site/privacy.html`. Must equal the `EXPO_PUBLIC_PRIVACY_POLICY_URL` used for the build |
| Support URL (required) | `__SUPPORT_URL__`: the hosted `docs/site/support.html`. Must equal `EXPO_PUBLIC_SUPPORT_URL` |
| Marketing URL (optional) | the hosted `docs/site/index.html`, or leave empty |
| User Privacy Choices URL (optional) | leave empty (account deletion is in the app) |
| Terms of Use | Apple's Standard EULA applies; our own Terms are linked in the app and from the description if you wish (`docs/site/terms.html`, or set `EXPO_PUBLIC_TERMS_URL`) |

Hosting options are in [`release-runbook.md`](./release-runbook.md) §4.

## 3. Age rating questionnaire

Answer for what the app contains and enables. Festie's relevant facts:

- **User-generated content: Yes.** Users create display names, crew names, meetup titles and notes, and
  totem photos that other crew members see. Moderation in place (App Review guideline 1.2): disallowed-
  word filter on names and meetup text (`public.moderation_terms`), Report on users, crews, meetups and
  photos, Block, admin Remove from crew, published zero-tolerance terms that users must accept, and
  reports reviewed within 24 hours ([`festival-data.md`](./festival-data.md) §8).
- **Sharing location with other users: Yes.** Crew members can see each other's live location while
  sharing is on (opt-in, foreground only, time-limited). Declare it wherever the questionnaire asks about
  sharing location or personal information with other users.
- **Messaging and chat: No.** There is no chat or direct messaging in v1.
- **Unrestricted web access: No.** The in-app browser opens only our configured privacy, terms and
  support pages.
- **Advertising: No.** No ads.
- **Violence, sexual content or nudity, profanity, horror, drugs, alcohol or tobacco, gambling,
  contests, medical or wellness content: None** in the app's own content. Festival schedules list
  artist names and set times only.
- **Parental controls / age assurance: No.**

Our Terms require users to be at least 13 and the app is not directed to children. If the questionnaire
produces a rating below 13+, use App Store Connect's option to choose a higher age rating and select 13+
so the store rating matches the Terms. If it produces a higher rating (for example 16+ or 18+), keep it and
raise the minimum age in [`legal/terms-of-use.md`](./legal/terms-of-use.md) §2 and the Children section of
the privacy policy to match, then regenerate the legal pages. Do not mark the app "Made for Kids".

## 4. Export compliance

`apps/mobile/app.json` sets `ios.infoPlist.ITSAppUsesNonExemptEncryption = false`. Festie uses only
encryption provided by iOS (HTTPS/TLS to Supabase, Mapbox and Expo) and implements no cryptography of its
own, which is exempt. App Store Connect therefore does not ask the export-compliance question per build.
If it ever does, answer that the app uses only exempt encryption (standard HTTPS).

## 5. Sign-in information for App Review

App Review signs in with the demo account (email plus 8-digit code from the `DEMO_LOGIN_EMAIL` and
`DEMO_LOGIN_CODE` function secrets). Enter them under App Review Information → Sign-in required, and use
[`app-review-notes.md`](./app-review-notes.md) for the Notes field.
