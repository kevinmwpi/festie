# Intellectual property review: Festie v1

Last reviewed: October 5, 2026, against the v1 code on this branch. §3.1 (name search) added October
15–16, 2026.

**This is an engineering checklist, not legal advice.** It records the content rules the code enforces
and the checks a person must still do. If you can, have a lawyer review the app name and the festival
content before a commercial launch.

## 1. Content rules for festival data

Festie shows festival schedules. What the app displays, and what it deliberately does not, is enforced by
the admin tooling and the database ([`../festival-data.md`](../festival-data.md) section 3 is the operating
procedure):

| Rule | How it is enforced |
|---|---|
| **Sample festival is fictional.** "Festie Demo Fest" uses invented artist names, is marked `is_demo` and shown with a "Sample" badge | `seed-data/demo-festival.json`; app badge and sort order (§5.5 of the contract) |
| **Real festivals are factual data from official public sources**: festival, stage and artist names, dates, set times. No descriptions, bios, editorial text or ticket information | Strict validator in `apps/admin-tools` (unknown fields are errors); there are no description or bio columns |
| **Every published real festival records its source** (`source_url`, the organizer's public schedule page) | Validator refuses to publish without it; database check `festivals_published_requires_source` (`status = 'draft' or is_demo or source_url is not null`); migration 007 reset legacy rows without a source to draft |
| **Names are used nominatively**, only to identify the festival, stages and artists, with a disclaimer of affiliation on the festival browsing screens, in Settings and in the Terms | `FESTIVAL_DISCLAIMER` (`apps/mobile/src/components/FestivalNotes.tsx`) on the Fests list, Lineup and the schedule browser (`schedule/browse`); a footer line in Settings; Terms §8 |
| **No logos, wordmarks, posters, official maps, artwork or brand colours** | `image_url` and `map_asset_url` must be null (validator); artists have no image column in the seed format; accent colours are chosen by us and used only as pastel fills |
| **No artist photos** unless licensed in writing; v1 shows none (artists are shown as monogram initials, `ArtistMonogram.tsx`) | No artist image field is accepted by `festival:seed` |
| **Map data** comes from Mapbox tiles (OpenStreetMap-based) and coordinates from public map data, never from a festival's site map | Coordinates only (`latitude`/`longitude`/bounds); no map image upload path |
| **Corrections and takedowns:** if an organizer asks, unpublish first (`status: draft`), then fix or remove | [`../festival-data.md`](../festival-data.md) sections 3–4; support page asks users to report schedule mistakes |

Why this approach: schedule facts (who plays where and when) are generally not protected by copyright,
while the organizer's presentation (logos, artwork, descriptions, photos, map designs) is. Festival and
artist names are trademarks used here only to refer to them. This reasoning has not been reviewed by a
lawyer; it is why the rules above are strict.

Earlier versions of this document described the use as "non-commercial fair use"; that framing is wrong
for an App Store app and is not relied on. Festie avoids copying protected expression instead.

## 2. User content

Users upload totem photos and write names and meetup text. The Terms of Use (§5) give us only the licence
needed to run the service, prohibit infringing content (§4) and provide reporting; reported content is
removed with `npm run admin -- reports:remove-content`. Copyright complaints go to the support email.

## 3. App name, icon and store listing

- [ ] **Trademark search for "Festie"** in the classes for software and apps (Nice classes 9 and 42) in
      every country you launch in, using the official search tools (USPTO Trademark Search, EUIPO / TMview,
      UKIPO), plus an App Store search for similar names. Record the result here.
      **Result so far: the name is not usable; see §3.1.**

### 3.1 Name search, October 15, 2026

| Check | Result |
|---|---|
| Texas Secretary of State trademark register, "Festie" | No match. Covers Texas registrations only |
| USPTO | Only the general USPTO.gov site search was run (it searches web pages, not marks), so there is no valid federal result yet. Not needed if the app is renamed |
| App Store and web | Three festival products already use the name (below) |

**Earlier users found**

| Product | Owner | What it is | Public since |
|---|---|---|---|
| **Festie** (festie.live, X @festielive) | Not stated on the site; page author metadata names Carol Monroe | Exactly the same name. Tagline "Your lineup. Your crew. Your weekend."; an unofficial Coachella 2026 companion to discover artists, build a playlist and find your crew | By April 2026 (Coachella 2026) |
| **FestieFam** (App Store, festiefam.app) | FESTIEFAM APP LLC (US) | A festival community app to connect with your squad, earn rewards and track your festival journey. App Store category Music | First version (1.0.1) about February 2026 |
| **Festie Bestie** (App Store, thefestivalapps.com) | Astral Design Ltd (Gibraltar), trading as Festival Apps | The community app of a five-app platform for outdoor events that also includes **Festie Foodie**. A chat room for every event, private group rooms and a global feed. Mainly UK events. App Store category Entertainment | First version (1.0) about March 2026 |

**Assessment.** All three are festival-goer products in our market and were public before Festie, which
has had no public release (TestFlight only). One uses the identical name with the same "crew" pitch; the
other two use "Festie" as a prefix, and one company uses it across several products. "Festie" is also
common slang, so we could not protect it ourselves. **Decision: rename before App Store submission.**
This is an engineering record, not legal advice; a trademark lawyer should confirm the new name.

**Renaming touches:** the App Store name and listing, `joinfestie.com` and `support@joinfestie.com`
(keep the domain redirecting and forwarding after the move; old builds link to it), `docs/legal/*.md` and
the generated pages and in-app screens, `values.json`, the EAS `EXPO_PUBLIC_*` URLs, the Resend sending
domain and the Supabase SMTP sender (runbook §2.7). The bundle identifier `com.kevin.festivalapp`, the
`festivalapp://` scheme, the App Store Connect app id and the Supabase project do not change.

**Chosen replacement: Glowspot (October 16, 2026), pending the checks below.**

| Check | Result |
|---|---|
| USPTO | One old record, GLOW SPOT (serial 75605078, reg. 2466197), Vector Products, Inc., a hand-held spotlight in class 11. **Dead**: cancelled February 10, 2012 (Section 8). No live GLOWSPOT mark found in web-indexed trademark data; a direct search of the USPTO database is still needed |
| App Store | **"GlowSpot \| جلوسبوت"** (Moltaqa), a salon booking app in Lifestyle, apparently for an Arabic-speaking market. Different category, but the same word is already in the store |
| Other uses | Beauty and skincare businesses (GlowSpot Skincare on Instagram, glow-spot.net, GlowSpot by MK spa, Glow Spot in San Antonio, a hobby salon project glowspotbw) and GlowSpot® safety textiles (Erez Therm). None in social, events, music or festival software |
| Domains | `glowspot.com`, `glowspot.app`, `glowspot.co` taken; `joinglowspot.com`, `getglowspot.com`, `glowspot.live`, `glowspot.io` available on October 16, 2026 |

**Assessment.** No user found in our category, and the only trademark is dead and for spotlights. The
risks are the existing salon app of the same name (App Store search collision; Apple requires a unique app
name, so the exact store name may need a qualifier) and the word's beauty association ("glow", "spot").
**Before adopting:** reserve the name in App Store Connect, run a direct USPTO search (live marks, classes
9, 41, 42 and 45), register the domains, and have a trademark lawyer run a knockout search.

**Other names screened.** About 5,500 compounds were generated and 250 were checked; the shortlist and
every rejection are in the October 16 screening sheet (not committed). Earlier candidate **Kinset** was
rejected: an existing sustainability data platform owns the name and `kinset.com`. Also rejected:

| Name | Why |
|---|---|
| Flagdrop | An existing racing schedule app |
| StageHop, Sethop | "StageHop – Concert Friends" (MVP App Studio, LLC) already shows which friends go to which shows and festivals; Sethop copies its pattern |
| Checkpoint | Registered CHECKPOINT marks for software (Check Point Software Technologies, e.g. US reg. 2849962, class 9) and several apps |
| Clashly | Existing apps (a Clash of Clans layout app and a bracket maker) |
| Rovra | Sound-alike of The Rovr Group, a social-networking company |
| Crewsy and other "crew" names | "Crew" is crowded in workforce apps, and "crew" is festie.live's tagline word |
| All "-flock" names | "Flock: Find Your Crew" is an App Store app with our pitch |
| RallyUp, Kickback, Linkup, Tagalong, Pullup, Meetpoint, GigMate, Yippi | Existing social or event apps of the same name |
| Setbreak, Afterset | Names owned by existing businesses |
| Meetspot, Hopspot, Meetmap, Afterglow, Wristband, Convoy | A live USPTO mark for a dating app (Meetspot), or existing social and event apps |
- [x] **App icon and splash are original.** `apps/mobile/assets/images/` (icon, splash, Android adaptive
      icon layers, favicon) holds simple original Festie artwork made for this app (a tent with a yellow
      flag on a pink gradient), replacing the Expo template artwork that showed Expo's logo. `app.config.ts`
      (`releaseArtworkProblems`) fails preview and production builds if any template file returns. A
      designer's version may still replace it; keep it original.
- [ ] Store listing: no festival or artist names in the app name, subtitle or keywords; screenshots show
      the demo festival or real schedules without logos or artwork.
- `com.kevin.festivalapp` and the `festivalapp://` scheme are generic identifiers in the developer's own
  namespace.

## 4. Third-party software and services

| Component | Licence / terms | Obligation |
|---|---|---|
| React Native, Expo SDK and modules, expo-router, @expo/vector-icons | MIT | None in-app |
| @supabase/supabase-js | MIT | None in-app |
| @rnmapbox/maps (React Native wrapper) | MIT | None in-app |
| Mapbox Maps SDK for iOS/Android (native, v11, pulled in by @rnmapbox/maps) | Mapbox Terms of Service (proprietary, not open source) | Keep the Mapbox logo and attribution visible on the map; stay within your Mapbox plan; use only a public `pk.` token in the app |
| Map tiles (Mapbox, OpenStreetMap data) | Mapbox ToS; OpenStreetMap ODbL | Attribution "© Mapbox © OpenStreetMap" is shown by the map control; do not hide it |
| TanStack Query, Zustand, react-native-mmkv, react-native-nitro-modules, piexifjs | MIT | None in-app |
| Space Mono font (`apps/mobile/assets/fonts`) | SIL Open Font License 1.1 (Expo template font) | None for embedding |

Verify before each release: `npx license-checker --production --summary` (or an equivalent) from
`apps/mobile`, and confirm the Mapbox attribution on a device ([`../qa-checklist.md`](../qa-checklist.md) §14).

## 5. Open items

- [ ] Trademark search done and recorded (§3). "Festie" is not usable; **Glowspot** is chosen (§3.1).
      Still open: App Store Connect name reservation, direct USPTO search, lawyer knockout search.
- [x] Original app icon and splash in place (§3); review the artwork before submission.
- [ ] Each published real festival checked against its `source_url` with no copied artwork or text (§1).
