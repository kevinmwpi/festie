# Intellectual property review: Festie v1

Last reviewed: October 14, 2026, against the v1 code on this branch, including the licensed photo
pipeline (migrations 012–013).

**This is an engineering checklist, not legal advice.** It records the content rules the code enforces
and the checks a person must still do. If you can, have a lawyer review the app name, the festival
content and the photo rules before a commercial launch.

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
| **Seed files carry no images: no logos, wordmarks, posters, official maps or brand colours** | `image_url` and `map_asset_url` must be null in a festival seed file (validator), and `festival:seed` never writes the image columns; accent colours are chosen by us and used only as pastel fills |
| **Artist and festival photos only with a licence record** approved by a person; an official festival logo only with the organizer's written permission or a press kit whose terms allow this use | The media pipeline, §2 |
| **Map data** comes from Mapbox tiles (OpenStreetMap-based) and coordinates from public map data, never from a festival's site map | Coordinates only (`latitude`/`longitude`/bounds); no map image upload path |
| **Corrections and takedowns:** if an organizer asks, unpublish first (`status: draft`), then fix or remove | [`../festival-data.md`](../festival-data.md) sections 3–4; support page asks users to report schedule mistakes |

Why this approach: schedule facts (who plays where and when) are generally not protected by copyright,
while the organizer's presentation (logos, artwork, descriptions, map designs) is, and so is every
photographer's photo. Festival and artist names are trademarks used here only to refer to them. This
reasoning has not been reviewed by a lawyer; it is why the rules above are strict.

Earlier versions of this document described the use as "non-commercial fair use"; that framing is wrong
for an App Store app and is not relied on. Festie avoids copying protected expression instead.

## 2. Licensed photos (migrations 012–013)

The app can show a photo for an artist (on Lineup cards) and a picture for a festival (in its card's icon
box), with a monogram or the flag icon when there is none. **At this review the registry
(`seed-data/media/registry.json`) has no entries, so no photos are published and every artist shows its
monogram.** The rules below apply from the first approved entry.

| Rule | How it is enforced |
|---|---|
| **One way in:** a photo reaches the app only through the media registry, approved by a person | `media:validate`; `media:upload` uploads approved entries only and clears any image in the bucket without one; the `artwork` bucket refuses all client writes (restrictive policies in 013, `rls.sql` R10–R13); a row's `image_url` requires an `image_license` (012 checks) |
| **Allowed licences:** CC0, public domain, CC BY and CC BY-SA 2.0–4.0 in their international or unported versions, the organizer's written permission, an official press kit, or artwork we made. **Refused:** NC, ND, country versions ("CC BY-SA 3.0 de"), all rights reserved, GFDL-only, fair use, anything unknown | `ALLOWED_LICENSES` (`apps/admin-tools/src/media/types.ts`); `mapLicense` (`commons.ts`); `media:validate` |
| **The credit names the photographer the way they ask:** the credit line the author requests on Commons (`Attribution`), word for word and never shortened; otherwise Commons' `Artist`; never the source ("Own work") | `fetchCommonsCandidate` and `buildRequestedAttribution` (`commons.ts`); `media-commons.test.ts` |
| **Every Creative Commons credit names its licence**, and a licence link in the registry points at that licence, not a country version | `media:validate` (`media-validate.test.ts`) |
| **The app shows the credit, links the licence and says what changed:** Settings → Photo credits lists every photo the device can show with its credit text and opens the photo's source page; a Licences section links each Creative Commons licence in use to its deed; the screen says photos are resized and may be cropped to fit | `apps/mobile/app/settings/credits.tsx`, `src/hooks/image-credits.ts` (`image-credits.test.ts`); [`../qa-checklist.md`](../qa-checklist.md) §13 |
| **Thumbnails, not originals:** at most 512 px on the longest side and 2 MiB | `media:validate`; bucket limits (013) |
| **Takedown the same day:** reject the entry and run `media:upload`, which clears the row, bumps the festival version so phones refetch, and removes the object | [`../agents/festival-pipeline.md`](../agents/festival-pipeline.md) §4; `seed-data/media/README.md` |

Why the photo rules are strict:

- **A Creative Commons licence is a permission with conditions.** Credit the creator the way they ask,
  name the licence and link to it, and say what you changed (CC 4.0 §3(a); CC 2.0–3.0 §4 ask for the
  same, with changes noted for adaptations). Fail a condition and the licence ends, and from then on
  showing the photo is infringement.
- **The versions end differently.** CC 2.0–3.0 licences end automatically on any breach, with no chance
  to fix it. CC 4.0 licences come back automatically if the breach is fixed within 30 days of discovering
  it, although the licensor can still claim for the time before. Photographers have repeatedly sued over
  attribution mistakes with Creative Commons photos ("copyleft trolling"), so treat every credit as a
  legal condition, not a courtesy.
- **A photo licence covers copyright only.** It gives no right to use the person in the photo to promote
  anything (publicity or personality rights) and no trademark rights. Inside the app the photo only
  identifies the act next to its set. It must never appear in marketing (§4).
- **Press kits usually allow "editorial use"**, meaning news coverage. Use `press-kit-editorial` only when
  the kit's terms cover showing the image in an app; otherwise ask the organizer for written permission
  (`organizer-permission`).
- **ShareAlike:** the app shows the photo and does not distribute a changed copy under another licence.
  Whether a display crop counts as an adaptation is a question for the lawyer
  ([`liability-checklist.md`](./liability-checklist.md) §3).

**Before approving an entry,** the reviewer checks (and records themselves in `review.by`):

1. The photo shows this act, not a namesake.
2. The licence on the Commons page matches the entry, is an international or unported version, and the
   page has no other restriction that rules out this use (Commons' "personality rights" notice is copied
   into `source.note`).
3. The credit text is the one the page asks for, word for word, and names the licence.
4. When Commons has several photos, a CC BY 4.0, CC BY-SA 4.0 or CC0 one is preferred.

## 3. User content

Users upload totem photos and write names and meetup text. The Terms of Use (§5) give us only the licence
needed to run the service, prohibit infringing content (§4) and provide reporting; reported content is
removed with `npm run admin -- reports:remove-content`. Copyright complaints go to the support email until
a DMCA designated agent is registered ([`liability-checklist.md`](./liability-checklist.md) L5).

## 4. App name, icon, store listing and marketing

- [ ] **Trademark search for "Festie"** in the classes for software and apps (Nice classes 9 and 42) in
      every country you launch in, using the official search tools (USPTO Trademark Search, EUIPO / TMview,
      UKIPO), plus an App Store search for similar names. Record the result here.
- [x] **App icon and splash are original.** `apps/mobile/assets/images/` (icon, splash, Android adaptive
      icon layers, favicon) holds simple original Festie artwork made for this app (a tent with a yellow
      flag on a pink gradient), replacing the Expo template artwork that showed Expo's logo. `app.config.ts`
      (`releaseArtworkProblems`) fails preview and production builds if any template file returns. A
      designer's version may still replace it; keep it original.
- [ ] Store listing: no festival or artist names in the app name, subtitle or keywords.
- [ ] **Screenshots and marketing show only the demo festival:** no real festival or artist names, and
      never a photo of a real person, in App Store screenshots, the store description, joinfestie.com or
      social posts. A photo's licence is not consent to use someone's likeness to promote the app. The
      website's app shots (`docs/legal/home-shots/`) use the demo festival and monograms (checked
      October 14, 2026).
- `com.kevin.festivalapp` and the `festivalapp://` scheme are generic identifiers in the developer's own
  namespace.

## 5. Third-party software and services

| Component | Licence / terms | Obligation |
|---|---|---|
| React Native, Expo SDK and modules (including expo-image), expo-router, @expo/vector-icons | MIT | None in-app |
| @supabase/supabase-js | MIT | None in-app |
| @rnmapbox/maps (React Native wrapper) | MIT | None in-app |
| Mapbox Maps SDK for iOS/Android (native, v11, pulled in by @rnmapbox/maps) | Mapbox Terms of Service (proprietary, not open source) | Keep the Mapbox logo and attribution visible on the map; stay within your Mapbox plan; use only a public `pk.` token in the app |
| Map tiles (Mapbox, OpenStreetMap data) | Mapbox ToS; OpenStreetMap ODbL | Attribution "© Mapbox © OpenStreetMap" is shown by the map control; do not hide it |
| TanStack Query, Zustand, react-native-mmkv, react-native-nitro-modules, piexifjs | MIT | None in-app |
| Space Mono font (`apps/mobile/assets/fonts`) | SIL Open Font License 1.1 (Expo template font) | None for embedding |
| Fredoka Bold font (`apps/mobile/assets/fonts`, `docs/site`) | SIL Open Font License 1.1 | None for embedding; keep `Fredoka-OFL.txt` / `fredoka-ofl.txt` next to each copy of the font file |
| Artist and festival photos | Per photo (§2) | Credit, licence link and change note on the Photo credits screen |

Verify before each release: `npx license-checker --production --summary` (or an equivalent) from
`apps/mobile`, and confirm the Mapbox attribution on a device ([`../qa-checklist.md`](../qa-checklist.md) §14).

## 6. Open items

- [ ] Trademark search done and recorded (§4).
- [x] Original app icon and splash in place (§4); review the artwork before submission.
- [ ] Each published real festival checked against its `source_url` with no copied artwork or text (§1).
- [ ] **Before approving the first photo, decide which Creative Commons versions to accept.** Accepting
      only CC BY 4.0, CC BY-SA 4.0, CC0 and public domain removes the no-cure risk of 2.0–3.0 but leaves
      more artists on monograms (many musician photos on Commons are CC BY 2.0 or CC BY-SA 3.0). Ask the
      lawyer ([`liability-checklist.md`](./liability-checklist.md) L8); until then, apply the §2 reviewer
      checks to every entry.
- [ ] With at least one photo published, check the Photo credits screen on a device: credit, licence
      link and change note ([`../qa-checklist.md`](../qa-checklist.md) §13).
