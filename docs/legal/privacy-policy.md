# Privacy Policy

<!--
Source of truth for the in-app Privacy Policy screen (apps/mobile/app/legal/privacy-policy.tsx) and
the hosted page (docs/site/privacy.html). After editing run: node docs/legal/generate.mjs
Allowed Markdown: see the header of docs/legal/generate.mjs. Every claim here is checked against the
code; docs/legal/data-compliance.md maps each statement to the code and tests that back it.
Placeholders (__LIKE_THIS__) are listed in docs/release-runbook.md, section 7.1. __SUPPORT_EMAIL__ is not a
placeholder: it stays in this file and the generator fills it in from docs/legal/values.json (web pages)
and EXPO_PUBLIC_SUPPORT_EMAIL (in-app screens).
-->

Last updated: October 12, 2026

Festie is a festival planning app operated by Kevin Pi. In this policy, "we", "us" and "our" mean Kevin Pi, and "Festie" means the app and its services. This policy explains what information the Festie app and its servers handle, why, who can see it, how long we keep it and the choices you have. If you have a question, email __SUPPORT_EMAIL__.

## Summary

- We collect only what Festie needs to work: your email address, the profile you choose, your festival plans and crews, the meetups and photos you post and, only while you turn it on, your location.
- No ads, no tracking, and no analytics, crash-reporting or advertising SDKs. We do not sell your personal information or share it for advertising. The only counting is of app installations: Mapbox (maps) and Expo (app updates) count them with a random identifier that is not linked to your account (section 4). Mapbox's optional map telemetry stays off unless you turn it on yourself in the map (section 4).
- Your live location is shown only to the crew you choose, only while Festie is open, and is visible to your crew for at most 15 minutes after the last update, then deleted.
- You can delete your account at any time in Settings, Delete account.

## 1. Information we collect

### Account

- **Email address.** Used to send your sign-in code and to identify your account. Other Festie users never see your email address.

### Profile

- **Display name and avatar.** The name you choose (up to 40 characters) and an avatar made of your initials, an emoji or a colour. Festie has no profile photos. Members of crews you belong to see your name and avatar.

### Festival plans

- **Festivals you follow.** Visible only to you.
- **Sets you pick.** Members of your crews for the same festival see your picks in the crew schedule.

### Crews

- **Crews you create or join** and your role in each (admin or member). Crew members see the crew name, its invite code and the list of members.

### Meetups

- **Meetups you create:** title, time, optional stage, optional pin on the festival map and optional notes (up to 500 characters). Members of that crew see them.

### Totem photos

- **Photos you choose or take for a meetup.** Before a photo leaves your phone, Festie converts it to a JPEG and removes its metadata, such as GPS location, camera details and the time it was taken. Photos are stored privately: only members of that crew can view them, through links that expire after an hour.

### Live location, only while you share it

- When you turn on location sharing for a crew, Festie sends your precise location (latitude, longitude, accuracy and direction) while the app is open on your screen: as you move and about every 2 minutes. Festie never collects your location in the background.
- Sharing stops automatically at the end of the time you chose (1, 4 or 8 hours, or "Until I stop", which still ends after 24 hours), and also when you turn it off, leave the crew, are removed from it or sign out.
- Your position is visible to your crew for at most 15 minutes after the last update, then deleted. Turning sharing off deletes it straight away (if your phone is offline at that moment, it simply expires).
- If you allow location access, the map can also show your own position as a dot. That stays on your phone and is not sent to us.

### Reports and blocks

- **Reports.** When you report a person, crew, meetup or photo, we store the reason you chose, any details you add (up to 500 characters), what you reported, a copy of the reported text at that moment (for example a name or meetup title) and that the report came from your account. The person you report is not told who reported them.
- **Blocks.** We store who you have blocked. The person you block is not told. Blocking someone also sends us a moderation notice, stored like a report, with their display name at that moment and a crew you share, so we can check whether they broke our Terms of Use.

### Technical information

- To run sign-in and the app's server, our hosting provider processes technical information such as your IP address, the time of each request and basic information your device sends with it (for example the operating system).
- **Sign-in logs.** Each sign-in, code request, session refresh and sign-out is logged with your email address, your IP address and the time. Each active sign-in session also records the IP address and device information of the phone using it. We use these records only to keep accounts secure and investigate abuse.
- To prevent abuse, we keep short-lived rate-limit records: an account identifier, or the IP address of a device that enters a sign-in code we cannot verify, with a timestamp. They are deleted about a day after they are created.
- When Festie starts, it checks Expo's update service for fixes to the app. These requests include the app version, platform and a random identifier for the installation that the update system creates. They contain no account information.

### On your phone

- To work offline at a festival, Festie keeps your sign-in session, a copy of your schedule, crews and meetups, changes waiting to sync, your reminders and your settings in the app's private storage on your phone, which iOS protects with its standard data protection. Signing out or deleting your account in the app removes your account data from the phone. If you are signed out without doing it yourself (for example, your sign-in expires or you deleted your account on another device), Festie keeps that copy, including changes not yet synced, so nothing is lost: it cannot be viewed while you are signed out, and it is removed when you sign in again and then sign out, when a different account (including a new one after a deletion) signs in on the phone, or when you delete the app. Deleting the app removes everything.
- Set and meetup reminders are scheduled on your phone as local notifications. We do not use push notification servers.

## 2. What we do not collect

- Your contacts or address book.
- Your location in the background, or at any time you are not sharing it with a crew.
- Microphone or audio. Festie never asks for microphone access.
- Your advertising identifier. Festie does not track you across other companies' apps or websites, so it never shows the App Tracking Transparency prompt.
- Analytics, crash-reporting or advertising data. Festie contains no analytics, crash-reporting or advertising SDKs, and it turns off the map's optional Mapbox telemetry each time it starts (you can turn it on yourself; see Mapbox in section 4). The only counting is the installation count described in section 4, with a random identifier that is not linked to your account.
- Payment information. Festie is free and has no purchases.

## 3. How we use information

We use information only to provide and protect Festie:

- to sign you in and keep you signed in;
- to show your profile, picks, meetups, photos and, while you share it, your location to your crews;
- to keep your plans available offline and in sync;
- to schedule reminders on your phone;
- to review reports and enforce our [Terms of Use](./terms-of-use.md), including an automatic filter that rejects disallowed words in names, crew names and meetup text;
- to prevent abuse and keep the service secure, for example with rate limits;
- to answer your support requests and meet legal obligations.

We do not use your information for advertising or profiling, we do not sell it, and we make no automated decisions about you with legal or similarly significant effects.

If you are in the European Economic Area or the United Kingdom, we rely on these legal bases: performing our contract with you (running the app you signed up for), our legitimate interests in keeping Festie safe and preventing abuse (moderation, security, rate limits), your consent for location sharing and for camera and photo access (you can withdraw it at any time by turning sharing off or changing the permission in iOS Settings), and compliance with legal obligations.

## 4. Who can see your information

### Your crews

Members of a crew see your display name and avatar, your picks for that crew's festival, the meetups and totem photos you post in that crew and, while you share it with that crew, your location. If you block someone, or they block you, neither of you sees the other's location, meetups (including their totem photos) or picks.

### Us

We can access the data on our servers to operate Festie, answer support requests and review reports.

### Service providers

These companies process data for us, only to run Festie. Each provider may use the information only to provide its service to us, is bound by contract (including data processing terms where the law requires them) to protect it at least as well as this policy does, and may not use it for its own purposes.

- **Supabase** hosts our database, sign-in, photo storage and server functions, and stores all account and app data, in the United States (Oregon, AWS us-west-2).
- **Resend** delivers sign-in code emails. It receives your email address and the email itself.
- **Mapbox** provides map tiles when you open the map or download a festival map for offline use. Your device sends Mapbox its IP address, basic device information, the map area being loaded and a random identifier for the installation that Mapbox uses to count active users, but no account information. Festie turns off Mapbox's optional telemetry each time it starts. The map's information (i) button includes a Mapbox Telemetry option: if you choose to participate there, the map also sends Mapbox anonymous usage data, which can include your device's location while Festie is open, until you close Festie completely. When Festie next starts, it turns telemetry off again. Mapbox uses telemetry data you choose to send under its own privacy policy.
- **Expo** provides the app update service described in section 1 and uses its random installation identifier to count how many installations receive each update. It receives no account information.

Apple distributes Festie through the App Store under Apple's own privacy policy. Festie does not use Apple's or Expo's push notification services.

### Others

We disclose information to authorities only if the law requires it or where necessary to protect someone's safety. If Festie is transferred to another operator, that operator must keep honouring this policy.

## 5. How long we keep information

- **Live location:** visible to your crew for at most 15 minutes after the last update, then deleted. Turning sharing off (while online), leaving the crew or being removed deletes it immediately.
- **Rate-limit records:** about a day after they are created.
- **Account, profile, picks, followed festivals, crews, meetups, photos and blocks:** until you delete them or delete your account.
- **Meetups in a crew you leave:** they stay visible to that crew until a crew admin removes them or you delete your account. If a crew admin removes you from a crew, your meetups in that crew are deleted.
- **Crews:** deleted automatically, with their meetups, when the last member leaves. Their photos are deleted with them when the last member deletes their account, and otherwise by routine cleanup within about a week.
- **Totem photos:** deleted when you replace them or delete the meetup, except a photo someone has reported: it is kept until we finish reviewing the report, and then deleted if it is no longer used (deleting your account still deletes it straight away). Photo files left behind, for example by a deleted crew or an interrupted upload, are removed by routine cleanup within about a week.
- **Reports and block notices:** kept as a moderation record. If you delete your account, reports you sent are kept without your name. Reports about you or your content keep the copy of the reported text taken at the time.
- **Banned accounts:** if we ban an account for breaking our Terms of Use, we remove it from every crew and delete its meetups, totem photos and shared location. We keep its profile, sign-in account and email address, and any other content it posted that we have not removed, as a record of the ban and to stop it signing in again.
- **Sign-in logs:** at most 90 days, then deleted automatically, including after you delete your account. The record of a sign-in session (its IP address and device information) is kept while the session can be used, and deleted when you sign out on that device while online or delete your account.
- **Logs and backups:** our hosting provider keeps other operational logs, such as server request logs, for at most 90 days, and database backups for a limited period. Deleted information can remain in backups until they expire.

## 6. Deleting your account

You can delete your account in the app: open Settings (your avatar on the Fests screen), tap Delete account, type DELETE and tap Delete my account. You need an internet connection. Deletion happens on our servers straight away and permanently removes:

- your profile: name, avatar and email address, and your sign-in account;
- your crew memberships. If you are a crew's only admin, the longest-standing member becomes admin; crews left with no members are deleted with their meetups and photos;
- the meetups and totem photos you created;
- your schedule picks and followed festivals;
- your shared location and the people you blocked.

Festie then stops location sharing, cancels your reminders and clears your account data from the phone. Changes that had not synced yet are discarded. Reports you sent are kept without your name so we can finish reviewing them. Sign-in log entries that mention your email address (section 1) are not part of your account; they are deleted automatically when they reach the 90-day limit in section 5. You can sign up again later with the same email, but nothing is restored. You can also ask us to delete your account by emailing __SUPPORT_EMAIL__ from the address you sign in with.

## 7. Security

- All connections between the app and our servers are encrypted (HTTPS/TLS).
- Database rules allow each account to read only its own data and what is shared in its crews. Automated tests check these rules on every change.
- Totem photos are stored privately and shown only through short-lived links. Your email address is never readable by other users.
- Your sign-in session stays in the app's private storage on your phone, protected by iOS data protection.
- Sign-in, invites, reports and other sensitive actions are rate-limited.

No system is perfectly secure. If you find a security problem, please email __SUPPORT_EMAIL__.

## 8. Children

Festie is not directed to children under 13, and you must be at least 13 to use it (see our [Terms of Use](./terms-of-use.md)). We do not knowingly collect personal information from children under 13. If you believe a child under 13 has given us personal information, email __SUPPORT_EMAIL__ and we will delete it.

## 9. Your rights and choices

- **Change your profile** at any time in Settings, Profile.
- **Delete your account** in Settings, Delete account (see section 6).
- **Location sharing** is off until you turn it on for a crew, and you can stop it at any time on the map or in Settings. You can also turn off location access for Festie in iOS Settings.
- **Camera, photos and notifications** are used only when you choose, and you can turn them off in iOS Settings.
- **Access and copies.** Email __SUPPORT_EMAIL__ for a copy of your information.

Depending on where you live (for example in the EEA, the UK or California), you may have the right to access, correct, delete or receive a portable copy of your personal information, to restrict or object to its processing, to withdraw consent, and to complain to your data protection authority. We will answer within the time the law requires, and we may need to confirm the request comes from your account's email address. We do not sell or share personal information as those terms are defined in California law, and we will not treat you differently for exercising your rights.

## 10. International transfers

Our servers are in the United States (Oregon, AWS us-west-2), and our service providers may process information in other countries, including the United States. Where the law requires it, these transfers are protected by safeguards such as the European Commission's Standard Contractual Clauses.

## 11. Changes to this policy

When we change this policy we will update the date at the top. If a change is significant, Festie will ask you to review and agree to the updated documents in the app before you continue.

## 12. Contact

Kevin Pi

Email: __SUPPORT_EMAIL__
