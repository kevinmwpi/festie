# Festie v1 device QA checklist

Manual QA on **physical devices** with a release-configuration build (EAS `preview` or `production`,
installed from TestFlight). Simulators and Expo Go are not acceptable for sign-off: location, camera,
notifications and Mapbox behave differently there. Run the whole list before
the first submission and the affected sections before every later one. Record the build number, devices,
iOS versions and date at the bottom.

Contract: [`v1-architecture.md`](./v1-architecture.md). Release steps: [`release-runbook.md`](./release-runbook.md).
Admin commands: [`festival-data.md`](./festival-data.md).

## 0. Setup

- [ ] Two iPhones, **A** and **B**, each signed in to TestFlight; ideally one on the oldest iOS you support.
      One physical Android phone for the festival-time spot-check in §7 (release gate 7 asks for iOS and
      Android even though v1 is submitted to the App Store only).
- [ ] The build points at the project you are testing (staging or production); migrations 006–011 are
      applied there ([`release-runbook.md`](./release-runbook.md) §2).
- [ ] Two real mailboxes you can read on the devices (custom SMTP is configured, runbook §2.7).
- [ ] `npm run admin -- demo:seed` has run on that project; at least one real festival is published
      (runbook §3).
- [ ] A Mac or laptop with the repo and `SUPABASE_URL` / `SUPABASE_SECRET_KEY` exported, to run
      `npm run admin -- reports:list` and to inspect tables in the Supabase dashboard.
- [ ] For §7 (time zones): set device A's time zone (Settings → General → Date & Time, automatic off)
      to one at least 3 hours away from the festival's time zone. Never change the device **clock**:
      TLS and token expiry break.

## 1. Install, first launch and permissions

- [ ] Fresh install launches to the sign-in screen ("Ready for the show?"); no "Festie can't start"
      screen (that means the build is missing `EXPO_PUBLIC_SUPABASE_*`).
- [ ] No permission prompt appears at launch (no location, camera, photos, notifications, tracking or
      local-network prompt). Every prompt appears only when its feature is first used.
- [ ] Release build: shaking the phone shows no developer menu.

## 2. Email sign-in, profile, terms

- [ ] Enter email A, tap "Email me a code": the code email arrives within a minute from your custom
      sender, shows an 8-digit code prominently and contains no link or button.
- [ ] The code screen shows 8 boxes; typing all 8 digits submits automatically; pasting the code from
      the email (or the iOS keyboard suggestion) works.
- [ ] A wrong code shows an error and lets you retry; "Resend code" is disabled for 60 seconds, then
      sends a new code; "Use a different email" returns to the email screen.
- [ ] "I already have a code" is shown only after a send error: tap "Use a different email", keep (or
      re-enter) the same email and tap "Email me a code" again within 60 seconds of the last code. An
      error ("Too many codes requested…") appears with an "I already have a code" link. The link opens
      the code screen ("Enter the 8-digit code we emailed to …") without sending a new email, the last
      code still signs in, and "Resend code" is available straight away. Before a send has failed the
      link is not shown.
- [ ] Profile setup: name required (1–40 characters), avatar choice works; "Let's go" stays disabled
      until "I agree to the Terms of Use and Privacy Policy" is ticked; both links open the documents
      (hosted pages in an in-app browser when `EXPO_PUBLIC_*_URL` is set, otherwise the in-app screens);
      the zero-tolerance note is visible.
- [ ] A display name containing a disallowed word (e.g. one from `npm run admin -- moderation:list-terms`)
      is rejected with a "not allowed" message; "Grape Escape" is accepted.
- [ ] Kill and relaunch: lands on the Fests tab without asking for a code again.
- [ ] Sign in with the same account on device B (existing profile, new device): the "accept terms" screen
      appears once before any crew content; its "Sign out" link works.
- [ ] On the "accept terms" screen and on profile setup, "Delete my account" opens account deletion
      without agreeing to the terms; deleting there returns to sign-in (App Review 5.1.1(v)).

## 3. Demo login (App Review path)

- [ ] On a signed-out device enter `DEMO_LOGIN_EMAIL`, tap "Email me a code", type `DEMO_LOGIN_CODE`, tap
      "Verify": signed in, terms screen shown, then the app with "Festie Demo Fest" (badge "Sample",
      sorted last) followed and "Festie Demo Crew" listed with three demo members, Jordan's meetup with
      a totem photo and demo members on the map near the stages.
- [ ] A wrong 8-digit code for the demo email fails with the normal wrong-code message.
- [ ] Block a demo member, sign out, sign in again with the demo code: the block is gone and the member
      is back on the map (the next reviewer must see the same state).
- [ ] Delete the demo account (§13), then sign in again with the demo code: works and the crew is back.
- [ ] Stay signed in to the demo account for 30 minutes or more (or come back later without signing out):
      the demo members are still on the map, and Jordan's meetup is still upcoming, not under "Earlier".

## 4. Deep links and invites

- [ ] Device A creates a crew: the share sheet text reads `Join my crew "<name>" on Festie. Code: XXXXXX —
      open festivalapp://group/join?code=XXXXXX — get the app: https://apps.apple.com/app/id6761392490`.
- [ ] **Deep link while signed out:** on signed-out device B, tap the `festivalapp://group/join?code=…`
      link (from Notes or Messages). Festie opens to sign-in; after sign-in (and profile setup for a new
      account) it lands on the Join screen with the code pre-filled and does **not** join until "Join"
      is tapped.
- [ ] The same link while signed in opens the Join screen pre-filled.
- [ ] Joining with a mistyped code shows "We couldn't find a crew with that code. Check it and try
      again."; lower-case codes and codes with spaces or a
      dash still work.
- [ ] After 10 wrong codes within an hour, the 11th attempt (even a correct code) shows a rate-limit
      message; it clears after an hour.

## 5. Festivals catalog

- [ ] Published real festivals appear; draft festivals never appear; the demo festival is marked
      "Sample" and listed last.
- [ ] Follow / unfollow works and survives a relaunch.
- [ ] Festival, lineup and schedule screens show: "Festie is an independent app and is not affiliated
      with or endorsed by any festival, organizer, or artist. Schedules can change — check official
      sources."
- [ ] Pull to refresh while online picks up a festival edit made with `festival:seed` (e.g. a renamed
      stage) without reinstalling.

## 6. Lineup, picks and conflicts

- [ ] Picking and un-picking sets updates "Schedule" immediately, also in airplane mode (shows as
      pending, syncs later).
- [ ] Overlapping picks show a conflict; back-to-back sets (end = next start) do not.
- [ ] Crew schedule shows the picks of crew members for the same festival, and not those of a blocked
      member.
- [ ] **Schedule changes** (seed a festival with one picked set marked `moved` to another day and one
      picked set marked `cancelled`, e.g. `seed-data/head-trip-2026.json` on staging; then pull to
      refresh):
  - [ ] The moved set shows a blue "Moved" chip and "Was Sat 11:00 PM" (or "Sat night 1:00 AM") with
        its note, sits under its new day in Lineup, Add sets, My Schedule and the crew schedule, and stays
        picked.
  - [ ] The cancelled set stays listed, struck through, with a red "Cancelled" chip and its note; it can
        be removed but has no Add button; it causes no conflict and never shows as "Next" on the map.
  - [ ] My Schedule shows "N of your picks changed" at the top; tapping an entry jumps to its day.
  - [ ] VoiceOver / TalkBack reads "Moved, was …" or "Cancelled" on the set and on its add/remove button.

## 7. Time zones, late-night sets and DST

- [ ] With device A in a different time zone, all set times match the official schedule in the
      **festival's** local time and the hint reads "Times shown in festival local time (…)".
- [ ] **1 AM day bucketing:** a set starting at 00:30 or 01:00 festival time appears at the end of the
      **previous** festival day's timeline (festival days start at 06:00), not as a separate day, and is
      labelled with that festival day plus "night" wherever a day is shown (Lineup, schedule browser, crew
      schedule, the set's action sheet, the map's "Next" list), e.g. "Fri night 1:00 AM".
- [ ] **DST:** on staging only, move the demo festival across a daylight-saving change and seed it:
      `npm run admin -- festival:shift-dates seed-data/demo-festival.json --start 2026-10-31 --out /tmp/dst.json`
      then `npm run admin -- demo:seed --file /tmp/dst.json` (the demo festival is in America/New_York;
      US DST ends on 1 November 2026). Every set on 31 Oct, 1 Nov and 2 Nov shows the same wall-clock time
      as in `seed-data/demo-festival.json`, sets keep their order around 1–2 AM on 1 Nov, and reminders fire
      at the displayed time. Re-seed the normal or review dates afterwards.
- [ ] Reminders: picking a set asks for notification permission the first time; denying it keeps the
      pick and shows "Added. Turn on notifications in Settings to get set reminders."; the reminder fires
      15 minutes before the set's start.
- [ ] Reminders after a schedule change: pick two future sets, then re-seed with one moved later and one
      cancelled. Without opening My Schedule (stay on Lineup or Map and pull to refresh), the moved set's
      reminder fires 15 minutes before its **new** start and the cancelled set's reminder never fires.
- [ ] Spot-check at least five sets of each published real festival against its `source_url` on a
      physical iPhone **and** a physical Android phone. This is release gate 7 (`v1-architecture.md` §7).
      For Android, install a development build (`npx eas-cli@latest build -p android --profile
      development-device` gives an installable APK), put the project's `EXPO_PUBLIC_SUPABASE_URL` and
      anon key in `apps/mobile/.env` (git-ignored; see the README), run `npx expo start` in `apps/mobile` and open the app from
      the development client. The Android build has not been tried in this repository; if it cannot be
      made, record that here and have the spec owner amend gate 7 for an iOS-only v1 before submitting.

## 8. Crews

- [ ] Crew detail shows members with avatars and an "Admin" badge, the invite code and "Share invite".
- [ ] Admin "Get a new code" invalidates the old code (joining with it fails) and the new one works.
- [ ] "Leave crew" asks for confirmation. When the only admin leaves, the longest-standing member
      becomes admin (check on B). When the last member leaves, the crew disappears.
- [ ] A removed or departed member's device drops the crew on its next refresh and shows "Not in this
      crew" if it was open.

## 9. Meetups and totem photos

- [ ] Create a meetup with title, time, stage and notes; it appears on B after B refreshes.
- [ ] The custom map pin option appears only for a festival with coordinates when Mapbox is configured;
      otherwise only the stage picker is offered.
- [ ] Create a meetup in airplane mode: shown with "Waiting to sync"; "Add totem photo" explains it must
      sync first; it syncs after reconnecting.
- [ ] Add a totem photo with the camera and one from the library (HEIC original): camera/photos
      permission is asked in context, the photo uploads and shows on B.
- [ ] Metadata stripped: download the object from Storage → `totems` in the dashboard and run
      `exiftool <file>`: no GPS, camera model or original date.
- [ ] The creator can delete their meetup; an admin sees "Remove meetup" on others' meetups; a member
      sees "Report meetup" / "Report photo".
- [ ] Meetup text with a disallowed word is rejected.

## 10. Report, block, remove, leave (App Review 1.2)

- [ ] Report a member, a meetup, a photo and the crew: each shows "Thanks — we'll review this within
      24 hours." and appears in `npm run admin -- reports:list` with the reason, details and snapshot.
      Reporting the same thing twice does not error.
- [ ] Block B from A (confirm "Block"): on A, B's meetups, picks and location disappear and B shows as
      "Blocked user" with Unblock; on B, A's location, meetups and picks disappear. B is not notified.
- [ ] Blocking also hides totem photos: with B blocked, A sees no photo on a meetup B created or a photo B
      uploaded (and vice versa).
- [ ] Unblock from Settings → Blocked users brings B's content back.
- [ ] Admin A removes B ("Remove from crew", confirm): B loses the crew, its meetups and members'
      locations; if B was sharing with that crew, B's sharing stops; B's meetup reminders for that crew
      are cancelled. The crew's invite code changes (A's invite card shows the new one), and B cannot
      rejoin with the old code.
- [ ] `npm run admin -- reports:remove-content <report_id>` on the photo report: the photo disappears on
      both devices after refresh; the report is marked actioned.
- [ ] The report-notification email (runbook §2.12) arrives for a new report and contains only the
      report id, reason and target type.

## 11. Live location on two devices

- [ ] On A open the Map tab with the crew selected, tap "Share location": the explainer reads "Only
      members of <crew> can see your location, only while Festie is open, for the time you choose. Your
      position is visible to your crew for at most 15 minutes after the last update, then deleted." The
      iOS prompt appears only after "Start sharing" and offers While Using / Once / Don't Allow (no
      "Always").
- [ ] B sees A's pin within about 30 seconds with "last seen" in minutes; walking 25 m or more moves it.
- [ ] **Heartbeat:** leave A open and still for 20 minutes (screen on): B keeps seeing A (updates about
      every 2 minutes) and A never disappears.
- [ ] **Pause:** send A to the background: A's status shows "Paused" and A sends nothing; on B, "last
      seen" grows and A's pin disappears 15 minutes after A's last update. Bringing A back to the
      foreground resumes sharing.
- [ ] **Expiry:** start sharing on A for "1 hour". After an hour with the app open, sharing stops by itself.
      Repeat with the app in the background during the expiry time: on reopening, sharing is off and B no
      longer sees A.
- [ ] Stop from the map ("Sharing location" → "Stop sharing my location") and from Settings ("Stop
      sharing location"): A disappears on B at B's next poll.
- [ ] Sign out, leaving the crew and being removed all stop sharing.
- [ ] **Deny at the first prompt:** fresh install, tap "Share location", "Start sharing", then "Don't
      Allow": no sharing session starts, so the status stays "Off" (not "No access") in Settings and on
      the Map, and nothing is sent. The app explains instead: the "Location access is off" alert with
      "Open Settings" (iOS reports it cannot ask again after a denial), or an inline error in the sheet
      if it still can. Tapping "Start sharing" again shows the alert; iOS does not prompt again.
- [ ] **Revoke while sharing:** while A is sharing, turn off Festie's location access in iOS Settings and
      return to the app: the Map control shows "Location access off" (its sheet offers "Open Settings"),
      Settings shows "No access" with a way to open iOS Settings, and nothing is sent until access is back.
- [ ] **Allow Once expiry:** grant "Allow Once", start sharing, then leave the app long enough for iOS to
      revoke the one-time grant (or relaunch it): the card, the Map sheet and Settings offer "Turn location
      back on" (not only "Open Settings"); tapping it shows the iOS prompt and sharing resumes after allowing.
- [ ] Airplane mode while sharing: no crash; sharing resumes when back online.
- [ ] Stop sharing in airplane mode: sharing stops on the phone and a toast says the server could not be
      reached and the last position expires within 15 minutes.
- [ ] On B, put the phone in airplane mode with A visible on the map: A's pin (and list entry) disappears
      once A's last position is more than 15 minutes old, even though B cannot poll.
- [ ] In the Supabase table editor, `location_shares` contains no row older than 15 minutes (a few
      minutes' lag before the purge job runs is acceptable; the app never shows them).

## 12. Offline, expired session and captive portals

- [ ] **Offline relaunch:** in airplane mode, kill and relaunch: the offline banner shows and Fests,
      lineup, schedule, crews and meetups render from cache.
- [ ] **Offline relaunch with an expired token:** sign in, kill the app, keep the phone offline for more
      than one hour (access tokens last 3600 s), relaunch still offline: the app opens on the Fests tab
      with cached data, never on the sign-in screen. Make a pick offline. Reconnect: the session refreshes
      silently and the pick reaches the server (check `user_set_selections`).
- [ ] **Captive portal:** with an expired token, join a Wi-Fi network with a captive portal (hotel, café or
      a travel router with a portal page) and open Festie before logging in to the portal: the app stays
      signed in and shows cached data (it does not return to sign-in). After accepting the portal, it
      syncs. Unsynced changes are never lost.
- [ ] Unit-covered: an empty 200/204 or empty 404 from a middlebox never empties crews, picks, the
      festival list or the profile, and never marks a queued write synced
      (`packages/data-access/test/empty-reply.test.ts`, `transport.test.ts`).
- [ ] Sign out with unsynced changes shows the "Unsynced changes" warning.

## 13. Settings and account deletion

- [ ] The avatar button on the Fests header opens Settings; Profile edit saves name and avatar and they
      update on B.
- [ ] About: Privacy Policy and Terms open the hosted pages (or in-app screens); "Contact support" opens
      Mail to `EXPO_PUBLIC_SUPPORT_EMAIL` with the version in the subject; "Help & support" opens the
      support page; Version shows "1.0.0 (build)".
- [ ] The legal screens' back button and links are readable (blue link colour, not pastel) and every
      `__PLACEHOLDER__` has been replaced in the release build.
- [ ] Delete account offline: "You're offline…" shown and nothing is deleted.
- [ ] Delete account online (A is the only admin of a crew with B): type DELETE, tap "Delete my
      account": A returns to sign-in with "Your account has been deleted."; on B, A is gone from the crew,
      B is admin, A's meetups and photos are gone; `reports` rows A sent remain with an empty reporter.
- [ ] Sign up again with A's email: a fresh account with no crews, picks or follows.

## 14. Map

- [ ] With a Mapbox token the map shows the festival area, stage and meetup pins and crew members; the
      Mapbox logo and attribution (i) are visible and not covered by controls.
- [ ] Offline map: download the festival map, go offline, the map still renders the area.
- [ ] A festival without coordinates (or a build without a token) shows the styled list fallback, not a
      blank or fake map.
- [ ] **Mapbox telemetry off:** with the phone behind an HTTPS-inspecting proxy, the map on screen and
      your own dot showing for 10 minutes, `events.mapbox.com` receives at most the billing events
      (turnstile / map load, which continue after the opt-out) and no location, gesture or performance
      events. The SDK source says the opt-out works on 11.18.2; this check confirms the build. Procedure
      and what to do if it fails: [`release-runbook.md`](./release-runbook.md) §5.4 step 4. Record the
      result in the sign-off.
- [ ] **Mapbox telemetry opt-in resets at launch:** the map's (i) button shows "Mapbox Telemetry"; after
      choosing "Participate" and then closing Festie completely and reopening it, the traffic check above
      again shows only billing events ([`release-runbook.md`](./release-runbook.md) §5.4 step 4).

## 15. Accessibility and appearance

- [ ] VoiceOver reads every icon button (settings, ⋯, map controls) with a meaningful label.
- [ ] VoiceOver on the Fests list: each festival card and its Follow / Unfollow toggle are separate
      elements, and the toggle can be focused and activated.
- [ ] The tab bar's icons and labels are centred vertically in the pill on a Face ID iPhone and on an
      iPhone SE, with no extra strip below the pill; on the Map, the map reaches the bottom edge.
- [ ] Largest Dynamic Type: no clipped buttons on sign-in, Settings and Delete account.
- [ ] Text on pastel festival accents stays readable; links use the blue link colour.

## Sign-off

| Build | Devices / iOS | Project | Tester | Date | Result |
|---|---|---|---|---|---|
| | | | | | |
