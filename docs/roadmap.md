# Festie roadmap

Status: **product direction, not a build plan.** Nothing here may be built until
[`v1-architecture.md`](./v1-architecture.md) is amended to include it; the contract's rule is to never
silently diverge. Moved here on October 13, 2026 from the "Engineering Super Plan" that was kept outside
this repository, and reconciled with what v1 ships. That plan is retired; this file replaces it.

## 1. Product thesis

Festival apps fail for the same reasons: no offline support, plans that are hard to compare, weak meetup
coordination, maps that break in crowds, and messaging that dies when the network does. Festie wins by
being an **offline-first group coordination tool**, not a feature-bloated super-app.

Differentiators:

1. **Group schedule comparison:** see conflicts and overlaps with friends instantly.
2. **Offline-first reliability:** works when cell service is overloaded.
3. **Practical movement guidance:** "leave now to catch your next set".

Success means a crew can install Festie before the festival and build their schedules, invite each other,
see where their plans split, set meetups with a time and a totem photo, open the app with no signal and
still see everything that matters, and get a reminder before the next important thing.

## 2. Shipped in v1

The contract is the authoritative description; this is the short version. Email sign-in with an 8-digit
code; festivals, lineups (including "set times to be announced") and a personal schedule with conflict
detection; crews joined by a 6-character code or an invite link; crew schedule views (overlap, per person,
divergence); meetups with a stage or map pin and a totem photo; local set and meetup reminders; an offline
cache with a sync queue; the Mapbox map with offline packs; opt-in live location sharing while the app is
open; report, block and remove; account deletion; licensed artwork with photo credits; festival
suggestions.

Movement guidance, the third differentiator, has not shipped yet.

## 3. Next: candidates after launch

- **Walk times between stages** (Mapbox Directions or a per-festival distance table), so conflict
  detection can warn about tight transitions: no overlap, but not enough time to get there.
- **ETA and "leave now" reminders:** `leave_time = next.start_time − walking_time − arrival_buffer`,
  scheduled as local notifications on the phone. Server push stays a non-goal; festival networks are
  unreliable.
- **Contract §9.6 residual risks:** a CAPTCHA on email-code requests, and invite codes that expire.
- **Universal links and deferred deep linking** (a v1 non-goal): revisit only if invite-to-join drop-off
  turns out to be high. Measuring it needs a privacy-reviewed method, because v1 has no analytics.

## 4. Later

- **Android on Google Play:** the Play Data Safety form, and a web page where people can request account
  deletion without the app (a Google Play requirement; check the current policy first). App Links only if
  universal links are adopted.
- **Crew chat:** removed from v1 (its tables are locked). Bringing it back starts with moderation,
  reporting and privacy-policy changes.
- **Nearby chat over Bluetooth (BitChat-style):** a transport abstraction (cloud or nearby), store-and-
  forward relay between nearby phones, and de-duplication by a client message id. Needs Bluetooth
  permission copy and privacy-policy changes.

## 5. Guardrails

- **No web version of the app.** The website holds only the legal and support pages.
- **Nearby chat only after the core value is proven,** isolated behind the transport abstraction, because
  it brings device-specific bugs, battery drain and a large QA matrix.
- **No background location by default and no location history,** as in v1.
- **No analytics by default.** v1 has none (see [`app-store-privacy.md`](./app-store-privacy.md)); adding
  any changes the privacy policy and the App Privacy answers.
- **New data, new review.** Anything that collects new data (movement, messages, Bluetooth) updates
  [`legal/data-compliance.md`](./legal/data-compliance.md), the privacy policy and the App Privacy answers
  together, and gets a legal look first ([`legal/liability-checklist.md`](./legal/liability-checklist.md)).

## 6. Quality targets (from the original plan; not yet measured)

| Metric | Target |
|---|---|
| Cold open to the cached home screen | < 2 seconds |
| Schedule toggle response | < 100 ms perceived |
| Crew schedule comparison, 20 members | < 500 ms |
| Festival download on first launch | < 10 MB |
