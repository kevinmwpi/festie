# App Review notes (template)

Paste the text between the lines into App Store Connect → your version → App Review Information →
**Notes**, after replacing every `__PLACEHOLDER__`. Put the same email and code in **Sign-in required**
(User name = the demo email, Password = the 8-digit code).

Before every submission, follow [`release-runbook.md`](./release-runbook.md) §3.3: the demo login must work
on the production project, `demo:seed` must have run after migration 007, and the demo festival should be
shifted so its sets are "up next" during the review window. The email and code are the
`DEMO_LOGIN_EMAIL` / `DEMO_LOGIN_CODE` Supabase function secrets; never commit them.

Every tap below was checked against the v1 code (screen labels in quotes are the exact on-screen text).
If you change a screen, update this file. App Store Connect limits Notes to 4000 bytes; keep the text
between the lines under about 3,700 bytes so the replaced placeholders still fit
(`awk '/^---$/{n++; next} n==1' docs/app-review-notes.md | wc -c`).

---

Festie helps friends plan a festival together: personal schedules, crew picks, meetups (with an
optional "totem" photo of the meeting point) and optional live location sharing with the crew while the
app is open.

DEMO ACCOUNT
Sign-in uses a one-time email code. For review, use:
- Email: __DEMO_LOGIN_EMAIL__
- Code: __DEMO_LOGIN_CODE__ (8 digits)
Enter the email, tap "Email me a code", type the code and tap "Verify" (ignore any emailed code). Tick
"I agree to the Terms of Use and Privacy Policy" and tap "Continue". The account is in "Festie Demo Crew"
for the fictional festival "Festie Demo Fest" (marked "Sample") with three demo members, a meetup with a
totem photo and live demo locations. If you leave the crew or block a demo member, sign out (Settings,
"Sign out") and sign in again with the same code: the membership is restored and blocks are lifted. If
you delete the account, signing in again recreates it.

USER-GENERATED CONTENT (Guideline 1.2)
Users must accept our Terms of Use (zero tolerance for objectionable content and abusive users) before
seeing any crew content. Names, crew names and meetup text pass a disallowed-word filter.
- Open the "Crews" tab, then "Festie Demo Crew".
- Report or block a person: tap a member (e.g. Maya) under Members, then "Report Maya" (pick a reason,
  tap "Send report") or "Block Maya" (confirm "Block"). A blocked member's meetups, picks and location
  disappear at once and we are notified; unblock in the same menu or in Settings, "Blocked users".
- Report a meetup or photo: on Jordan's meetup tap "⋯", then "Report meetup" or "Report photo".
- Report the crew: scroll down, tap "Report this crew". ("Leave crew" is below it; the location steps
  need the crew, so try it last.)
- Admins also get "Remove from crew" on another member and "Remove meetup" on another member's
  meetup. The demo crew's admin is demo member Maya, so these need a second account: create a crew
  ("Create" on the Crews tab), join it with its invite code from another email and add a meetup there.
Reports are reviewed within 24 hours; offending content is removed and offending users are banned.

LOCATION SHARING
Foreground only; there is no background location. The Map shows the crews of the selected festival, so
on the "Fests" tab tap "Festie Demo Fest", then open "Map" with "Festie Demo Crew" selected: the demo
members appear near the stages. Tap "Share location", pick a duration (1, 4 or 8 hours, or "Until I
stop", at most 24 hours) and tap "Start sharing"; iOS then asks for permission ("While Using the App"). Only that crew sees your position,
for at most 15 minutes after the last update, then it is deleted. To stop, tap "Sharing location", then
"Stop sharing my location", or use Settings, "Stop sharing location".

ACCOUNT DELETION (Guideline 5.1.1(v))
On "Fests" tap your avatar (top right) for Settings, then "Delete account", type DELETE and tap "Delete
my account". The account and its data are deleted on our server immediately.

FESTIVAL DATA
Festie is independent and not affiliated with or endorsed by any festival, organizer or artist; the
"Fests" list, "Lineup", the Schedule tab's "+" (add sets) screen, Settings and the Terms say so. Real
schedules are factual (names, stages, set times), entered from organizers' public official schedules with
the source recorded; no logos, artwork or photos. Published real festivals: __REAL_FESTIVALS__.

PERMISSIONS
Location (While Using): map position and, only while sharing, for your crew. Camera/Photos: only for a
totem photo; location metadata is removed before upload. Notifications: optional local reminders.

Contact: __SUPPORT_EMAIL__

---
