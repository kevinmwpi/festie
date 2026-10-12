# @festival/data-access

Supabase + offline-cache data layer for the Festie mobile app. It implements
`docs/v1-architecture.md` §4.1 on top of `@festival/sync-engine` (local SQLite cache and offline
write queue). Everything here is plain async functions; React Query hooks live in the app
(`apps/mobile/src/hooks`), with query keys that include the auth user id.

## Ground rules

- **Cache-first reads.** Screens render from `getLocal*` functions (SQLite/MMKV) immediately, then
  call the matching `refresh*`/`list*`/`fetch*` function in the background only while
  `isOnline()` (re-exported from `@festival/sync-engine`) is `true`. Refresh functions write the
  cache and resolve the fresh local rows.
- **Launch and routing never touch the network.** Use `getStoredSession()` and
  `getCachedProfile()` only. Never await `supabase.auth.getSession()/getUser()` on launch or
  render paths.
- **Identity for offline paths** comes only from `getCachedProfile()` (MMKV). Writes and RPCs
  check the stored session first and throw `TransientAuthError` **without sending** when it is
  missing.
- **Errors.** Show `toUserMessage(error)`. Branch on `getErrorCode(error)` (or
  `isAppErrorCode(error, 'group_full')`) rather than message text.
- `users` is never selected with `*` or `email`; member selects use explicit columns.
- **Refresh reads are complete or fail.** PostgREST caps every response at `max_rows` (1000) without
  an error, and refreshes delete local rows the server did not return, so every unbounded read is
  paged (`range` + exact count, ordered by primary key) and `in(…)` filters are chunked. If the data
  changes mid-read repeatedly, the refresh throws `DataAccessError` `result_changed` (status 503)
  instead of merging a partial result. A reply that is not PostgREST's (supabase-js reports an empty
  2xx/204 or an empty 404 as success with `data` and `count` null) is never read as "no rows": a page
  without a JSON array and a count, a single-row read (`maybeSingle`, also counted) without a count, or
  a table RPC (`get_my_profile`, `create_group`, `join_group`, `upsert_my_profile`) without an array
  throws `DataAccessError` with `status: 0` (shown as offline, retryable) and the cache is untouched.
- **Direct online writes win over in-flight refreshes.** Leaving a crew, removing a member, renaming,
  rotating the invite code, following and unfollowing update the cache as soon as the server accepts
  them. A `listMyGroups`, `refreshGroupDetail` or `refreshUserFestivals` that was already in flight
  leaves those groups / festivals as they are locally; the next refresh settles them.

## Setup (MOBILE-A, `src/providers`)

| Export | Signature | Notes |
|---|---|---|
| `supabaseConfigError` | `string \| null` | Non-null when `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` (alias `EXPO_PUBLIC_SUPABASE_KEY`) is missing/invalid. Show the config-error screen; no client exists and every network call throws `ConfigError`. |
| `configureDataSync()` | `() => void` | Call once at app start. Wires the sync engine to Supabase (`createSupabaseSyncTransport()`) with the stored-session pre-check and the local-owner gate: nothing is sent unless the stored session's user is `app_meta.local_owner_auth_user_id` (so a kept queue is never sent with another account's session before `ensureLocalOwner` runs — flush again after it). Every write selects the affected ids, so PostgREST always answers with a JSON array. A response that cannot be PostgREST's (a 4xx without an error code, such as an HTML proxy/WAF page, or any non-array reply, including an empty 2xx/204 or an empty 404) is reported as a connectivity failure (`status: 0`): the write stays queued, never dropped or marked synced. |
| `setAuthAutoRefresh(active)` | `(boolean) => void` | Call with `true` on AppState `active`, `false` on `background`. |
| `subscribeToAuthChanges(handler)` | `((event, session) => void) => () => void` | Returns an unsubscribe. No-op without config. Call `ensureLocalOwner(getStoredSession().authUserId)` once at launch (before anything is enqueued) and on `SIGNED_IN` call `ensureLocalOwner(session.user.id)` — an expired stored token is recovered with `TOKEN_REFRESHED`/`INITIAL_SESSION`, never `SIGNED_IN`; on `TOKEN_REFRESHED`/`SIGNED_IN` call `flush()`; on `SIGNED_OUT` run the `session_lost` flow. `signOut()`/`deleteAccount()` themselves usually emit `SIGNED_OUT`, so make the orchestrator re-entrancy safe. The subscription follows client replacement (see `signOut()`): `INITIAL_SESSION` is delivered once, and events from a retired client are never delivered. |
| `getSupabase()` | `() => SupabaseClient<Database>` | Escape hatch; throws `ConfigError` without config. Prefer the functions below. |
| `fetchWithTimeout(ms?, opts?)` | fetch factory | Used by the client (15 s; storage uploads 90 s; token refreshes 10 s so a retry after a lost response lands inside the 30 s `refresh_token_reuse_interval`). Rejects with `FetchTimeoutError` (`name: 'TimeoutError'`). A token-refresh response (`/auth/v1/token?grant_type=refresh_token`) that is a 5xx, a 429, not JSON (captive portal, proxy or CDN page — including `200 text/html`), or an ok JSON body without a session (`access_token`, `refresh_token`, `expires_in`) rejects with `NonAuthoritativeAuthResponseError` (a `TypeError`), so auth-js treats it as `AuthRetryableFetchError` and keeps the session; JSON 4xx verdicts such as `400 refresh_token_not_found` pass through and sign the user out. |

## Session & auth

| Export | Signature | Behaviour |
|---|---|---|
| `getStoredSession()` | `() => { authUserId: string; expiresAt: number } \| null` | **Synchronous** parse of MMKV `festival-auth`/`supabase_session`. Requires `refresh_token` and `user.id`. `expiresAt` is epoch **milliseconds** (0 if unknown). Returned even when the access token is expired. |
| `requireStoredSession()` | `() => StoredSession` | Throws `TransientAuthError` when absent. |
| `requestEmailCode(email)` | `(string) => Promise<void>` | `auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`. Throws `ValidationError` for a malformed email, `AuthApiError` (e.g. 429 `over_email_send_rate_limit`) or `AuthRetryableFetchError` (offline). |
| `verifyEmailCode(email, code)` | `(string, string) => Promise<Session>` | `verifyOtp({ email, token, type: 'email' })`; only after an `AuthApiError` 4xx **and** an 8–10 digit code **and** no `demo-login` 404 yet this app session → `demo-login` → `verifyOtp({ token_hash, type: 'email' })`. Otherwise rethrows the original error. Calls `ensureLocalOwner` before resolving. Whitespace in the code is ignored. |
| `ensureLocalOwner(authUserId)` | `(string) => Promise<void>` | If `app_meta.local_owner_auth_user_id` differs (or is unset), wipes local user data, the signed-URL cache and a foreign profile cache, then records the owner. Idempotent and single-flight: concurrent calls for the same user share one in-flight promise; a call for another user waits for it, so the latest call decides the owner. |
| `signOut()` | `() => Promise<void>` | `auth.signOut({ scope: 'local' })` (failure ignored, waits at most `SIGN_OUT_SERVER_TIMEOUT_MS` = 5 s) → `clearLocalSession()`. Never throws for network reasons. When the server call times out, the Supabase client is retired: the stalled call can no longer read or write the persisted session or emit events, and the next sign-in runs on a fresh client. |
| `deleteAccount()` | `() => Promise<void>` | `functions.invoke('delete-account', { method: 'POST' })`; must return `{ deleted: true }` or it throws `DataAccessError` (`status` 5xx/401, or `code: 'delete_not_confirmed'`) and **nothing local is touched**. On success: local sign-out + `clearLocalSession()`. Throws `TransientAuthError` without a session. |
| `clearLocalSession()` | `() => Promise<void>` | Local wipe only (§4.1 steps 2–4), in order: remove MMKV session → `clearLocalUserData()` → clear MMKV `profile-cache` and the signed-URL cache → clear `local_owner_auth_user_id`. Use for a voluntary sign-out wipe (inside `signOut()`/`deleteAccount()`, and when a `sign_out` follows a `session_lost`). `performSignOut('session_lost')` does **not** call it while the stored session is gone: it keeps SQLite, the offline queue and the profile cache for the same account and clears only the signed-URL cache (see below). |

`performSignOut` order (MOBILE-A, `apps/mobile/src/providers/session-actions.ts`; v1-architecture §5.1):

- `sign_out`: `stopLocationSharingNow()` → `cancelAllReminders()` → `signOut()` → `queryClient.clear()` →
  `resetAppStore()` → `router.replace('/auth/enter-email')`.
- `delete_account`: `deleteAccount()` **first** (a failure while still signed in rejects and touches nothing)
  → `stopLocationSharingNow()` → `cancelAllReminders()` → the same cache/store/route steps.
- `session_lost` (involuntary `SIGNED_OUT`): `stopLocationSharingNow()` (local half only) →
  `cancelAllReminders()` → clear the signed-URL cache only, **keeping** the SQLite cache, the offline queue
  and the MMKV profile cache under the same local owner (if a stored session is somehow still present,
  `clearLocalSession()` runs instead) → the same cache/store/route steps. The same account signing back in
  flushes its queue; a different account is isolated by `ensureLocalOwner`, which wipes first. A
  `sign_out` requested afterwards while still signed out runs `clearLocalSession()`.

Warn before a voluntary sign-out when `getPendingCount() > 0` (sync-engine).

## Profile

| Export | Signature | Behaviour |
|---|---|---|
| `getCachedProfile()` | `() => CachedProfile \| null` | Sync MMKV read. `null` unless a stored session exists **and** the cached `auth_user_id` matches it. `CachedProfile = { id, display_name, avatar_type, avatar_value, auth_user_id }` (`id` is `public.users.id`). |
| `requireCachedProfile()` | `() => CachedProfile` | Throws `TransientAuthError` (no session) or `ProfileRequiredError` (`code: 'profile_required'`). |
| `getMyProfile()` | `() => Promise<CachedProfile \| null>` | Online RPC `get_my_profile`; refreshes the cache, or clears it only when the RPC returns an empty array. `null` → route to profile setup. A non-array reply throws (`status: 0`) and keeps the cache. |
| `saveMyProfile(input)` | `({ display_name, avatar_type, avatar_value }) => Promise<CachedProfile>` | Validates (name 1–40 chars trimmed, avatar type `initials`/`emoji`/`color`, value ≤ 100) → RPC `upsert_my_profile` → cache. Server may raise P0001 `content_not_allowed`. |
| `validateProfileInput`, `AVATAR_TYPES`, `DISPLAY_NAME_MAX_LENGTH` | | For form validation. |

## Festivals

| Export | Signature | Behaviour |
|---|---|---|
| `getLocalFestivals()` | `() => Promise<Festival[]>` | Cached published festivals; demo festivals sort last. `is_demo` is a boolean. |
| `getLocalFestival(id)` | `(string) => Promise<Festival \| null>` | |
| `refreshFestivalCatalog()` | `() => Promise<Festival[]>` | Online. Upserts published festivals and deletes cached festivals/stages/sets/lineup rows that are no longer published. Call on launch and pull-to-refresh. |
| `fetchAndCacheFestival(id)` | `(string) => Promise<FestivalBundle \| null>` | Online. Light `select id, version` first; downloads stages/sets/lineup (`festival_artists`)/artists only when the version changed. `null` (and removed locally) when no longer published. A server without migration 014 (`PGRST205` on `festival_artists`) yields an empty lineup, not a failure. |
| `getLocalUnscheduledArtists(id)` | `(string) => Promise<UnscheduledArtist[]>` | Cache only. Announced artists (`festival_artists`) with no set of any status in the festival, with `billing_order`; billing first, then name. Pair with `describeLineupAvailability` from `@festival/domain` for the `empty \| tba \| partial \| scheduled` state. |
| `getLocalFestivalBundle(id)` | `(string) => Promise<FestivalBundle \| null>` | `{ festival, stages, artists, sets }`; `artists` is the announced lineup plus every set's artist. Stages carry `latitude/longitude` (no `map_x/map_y`). Sets carry `status` (`scheduled`, `moved`, `cancelled`), `original_start_time` and `change_note`; cancelled sets stay in the bundle (render them with `describeSetChange` from `@festival/domain`). A changed status reaches the cache only after `festivals.version` changes. |
| `hasCachedFestivalBundle(id)` | `(string) => Promise<boolean>` | |
| `getLocalFestivalLineup(id)` | `(string) => Promise<FestivalLineupRow[]>` | Sets joined with artist/stage names and `artist_image_url`. |
| `getLocalImageCredits()` | `() => Promise<ImageCredit[]>` | Cache only. Every cached artist and festival photo (`image_url` set) as `{ subject_type: 'artist' \| 'festival', subject_id, name, image_url, image_credit, image_license, image_source_url }`, ordered by name. Backs Settings → Photo credits. |
| `getLocalUserFestivals()` | `() => Promise<LocalUserFestival[]>` | Followed festivals (cache). |
| `refreshUserFestivals()` | `() => Promise<LocalUserFestival[]>` | Online; replaces the cache, except festivals followed or unfollowed while it was in flight (they keep their local state). |
| `followFestival(id)` / `unfollowFestival(id)` | `(string) => Promise<void>` | Online writes (not queued); already-following is not an error. |
| `toggleUserFestival(id)` | `(string) => Promise<boolean>` | `true` when now followed. |

Format every time with `@festival/domain` helpers and `festival.timezone`.

Festivals and artists carry `image_url` (a public https URL in the `artwork` bucket when an approved,
licensed photo exists, else `null`) with `image_credit`, `image_license` and `image_source_url`
(migration 012). The app shows a photo only when `image_url` is set and falls back to the monogram /
flag icon otherwise or when it fails to load.

## Festival suggestions

| Export | Signature | Behaviour |
|---|---|---|
| `suggestFestival(input)` | `({ name, url?, note? }) => Promise<string>` | Online RPC `suggest_festival` (never queued). Trims; name 1–120, website an `https://` address ≤ 500 (`https://` is added to a bare "fest.example"), note ≤ 300 → `ValidationError` with `field` before anything is sent. P0001 `rate_limited` (5 a day), `content_not_allowed`, `invalid_input`. The same name again resolves the same id. |
| `validateFestivalSuggestion(input)`, `normaliseSuggestionUrl(value)`, `FESTIVAL_SUGGESTION_{NAME,URL,NOTE}_MAX_LENGTH` | pure | Form validation. |
| `toSuggestionErrorMessage(error)` | `(unknown) => string` | `toUserMessage`, except `rate_limited` → `SUGGESTION_RATE_LIMITED_MESSAGE` ("You've sent a lot of suggestions today. Try again tomorrow."). |

## Schedule (selections — offline queue)

| Export | Signature | Behaviour |
|---|---|---|
| `toggleSetSelection(festivalId, setId)` | `(string, string) => Promise<boolean>` | Queued. Upsert on `(user_id, set_id)` ignoring duplicates; delete by `user_id + set_id`. Works offline. `true` when now selected. |
| `getLocalSelections(festivalId)` | `(string) => Promise<LocalSelection[]>` | `pending_sync = 1` until the server accepted it. |
| `getBrowseSchedule(festivalId)` | `(string) => Promise<ScheduleRow[]>` | Full lineup with `selection_id`/`selection_pending`, including moved and cancelled sets. |
| `getSelectedSchedule(festivalId)` | `(string) => Promise<ScheduleRow[]>` | Includes picks of cancelled sets (so the app can flag them). |
| `getLineupWithConflicts(festivalId)` | `(string) => Promise<Array<ScheduleRow & { is_conflicting }>>` | Back-to-back sets do not conflict; cancelled sets never do. |
| `getConflictSetIds(rows)` | `(rows) => Set<string>` | Pure. Ignores cancelled sets. |
| `refreshUserSelections(festivalId)` | `(string) => Promise<LocalSelection[]>` | Online merge: never drops `pending_sync = 1` rows, never resurrects rows with a queued delete — including operations a concurrent flush completes while the fetch is in flight (the queue is snapshotted before the fetch and tracked during it). Writes nothing if local data was wiped (sign-out) meanwhile. |
| `refreshSchedule(festivalId)` | `(string) => Promise<LocalSelection[]>` | `flush()` then `refreshUserSelections`. |

## Groups ("crews")

| Export | Signature | Behaviour |
|---|---|---|
| `getLocalGroups()` | `() => Promise<GroupSummary[]>` | `Group & { my_role, member_count }`, newest first. |
| `listMyGroups()` | `() => Promise<GroupSummary[]>` | Online. **Replaces** the user's memberships locally: memberships/groups not returned are deleted with their members and meetups. Groups created, joined, left or changed locally while it was in flight keep their local state. |
| `getLocalGroupDetail(id)` | `(string) => Promise<GroupDetail \| null>` | `{ group, my_role, members, meetups }`. Each member: `{ ...GroupMemberRow, user: PublicUser \| null, is_blocked }` — render blocked members as "Blocked user" with Unblock. Meetups exclude blocked creators. |
| `refreshGroupDetail(id)` | `(string) => Promise<GroupDetail \| null>` | Online refresh of group, members, profiles, meetups and members' selections. Meetups and own selections with queue activity before or during the fetch keep their local state (same rule as `refreshUserSelections`). `null` (purged locally) when the user is no longer a member. Writes nothing when the group was left or changed locally (member removed, renamed, invite rotated) while the fetch was in flight. |
| `createGroup({ name, festival_id })` | `=> Promise<CreatedGroup>` | RPC `create_group` → `{ group_id, name, festival_id, invite_code }`. Name 1–60. P0001 `festival_not_found`, `rate_limited`, `content_not_allowed`. |
| `joinGroup(code)` | `(string) => Promise<JoinedGroup>` | Code normalised (uppercase, letters/digits only). Zero rows → `InviteNotFoundError`. P0001 `group_full`, `rate_limited`. → `{ group_id, group_name, festival_id, member_count }`. |
| `leaveGroup(id)` | `(string) => Promise<void>` | RPC; purges locally. |
| `removeGroupMember(groupId, userId)` | `=> Promise<void>` | Admin RPC. P0001 `not_group_admin`, `cannot_remove_self`. |
| `rotateInviteCode(groupId)` | `=> Promise<string>` | Admin RPC; new code. |
| `renameGroup(groupId, name)` | `=> Promise<void>` | Admin direct update; non-admin → P0001 `not_group_admin`. |
| `getCombinedSelections(groupId, festivalId)` | `=> Promise<CombinedSelectionRow[]>` | Cache only; excludes blocked users. Refresh via `refreshGroupDetail`. |
| `normaliseInviteCode(code)`, `isWellFormedInviteCode(code)` | pure | |
| `purgeGroupLocally(groupId)` | `=> Promise<void>` | Exposed for the location provider on `not_group_member`. |

Any group call that fails with P0001 `not_group_member` purges that group locally before
rethrowing; the UI should navigate away and invalidate group queries.

## Meetups (offline queue) and totem photos

| Export | Signature | Behaviour |
|---|---|---|
| `createMeetup(input)` | `(MeetupInput) => Promise<LocalMeetup>` | `{ group_id, title (1–80), starts_at (ISO), stage_id?, notes? (≤ 500), latitude?, longitude? }` (both or neither). Queued; resolves the optimistic row (`pending_sync: 1`). |
| `updateMeetup(id, patch)` | `=> Promise<LocalMeetup>` | Creator only (`ValidationError` otherwise, `NotFoundError` if not cached). Queued as an `update` (never an upsert): if the meetup was deleted on the server meanwhile (admin, moderation), the edit is dropped with the local row and the sync engine emits `{ type: 'missing', table: 'meetups', recordId }` — invalidate meetup queries on it. |
| `deleteMeetup(id)` | `=> Promise<void>` | Creator or admin. Queued; when the delete reaches the server (now or after reconnecting) the transport removes the meetup's totem object, using the path from the deleted server row. |
| `getLocalMeetups(groupId)` / `getLocalMeetup(id)` | | Cache. |
| `uploadTotemPhoto(photo, meetup)` | `({ base64, mimeType? }, { id, group_id }) => Promise<string>` | Flushes first; still queued → `MeetupNotSyncedError` ("Add the photo once this meetup syncs"). Input must be **JPEG** base64 (pick with `expo-image-picker` `{ base64: true, quality: 0.8, exif: false }`, iOS `preferredAssetRepresentationMode: Compatible`); EXIF, XMP, IPTC/Photoshop, comment and other non-rendering metadata segments are stripped, ≤ 5 MB. Reads the current `totem_path` from the server (`meetup_not_found` before uploading if the meetup is gone), uploads `totems/<group_id>/<meetup_id>/<uuid>.jpg` with `upsert: false`, sets `meetups.totem_path` online, removes the photo it replaced, updates the cache, resolves the path. |
| `getTotemSignedUrl(path)` | `(string) => Promise<string>` | 1 h signed URL, cached in memory for 50 min. |
| `clearSignedUrlCache()` | | Done by sign-out. |

## Location sharing (online RPCs — MOBILE-B `LocationSharingProvider`)

| Export | Signature | Behaviour |
|---|---|---|
| `shareLocation(groupId, coords)` | `(string, { latitude, longitude, accuracy?, heading? }) => Promise<void>` | RPC `share_location`. Negative accuracy/heading (expo "unknown") are sent as null. Server throttles to 1 write / 5 s. |
| `stopSharingLocation(groupId)` | `=> Promise<void>` | RPC `stop_sharing_location`. |
| `getGroupLocations(groupId)` | `=> Promise<FriendLocation[]>` | Positions from the last 15 min, excluding the caller and blocked users: `{ user_id, display_name, avatar_type, avatar_value, lat, lng, accuracy, heading, recorded_at }`. |

`not_group_member` from these purges the group locally (stop sharing on that error).

## Moderation

| Export | Signature | Behaviour |
|---|---|---|
| `reportContent(type, targetId, reason, details?)` | `('user'\|'group'\|'meetup'\|'photo', string, ReportReason, string?) => Promise<string>` | For `photo`, `targetId` is the meetup id. Reasons: `REPORT_REASONS`. Details ≤ 500. Duplicate reports resolve the existing id. P0001 `rate_limited`, `invalid_input`. |
| `blockUser(userId)` | `=> Promise<void>` | RPC, then deletes that user's meetups and selections from the cache and records the block locally. Invalidate group/meetup/schedule queries afterwards. |
| `unblockUser(userId)` | `=> Promise<void>` | Content returns on the next refresh. |
| `listBlockedUsers()` | `=> Promise<BlockedUser[]>` | Online; refreshes the local block list. `display_name` is null when no crew is shared any more. |
| `getLocalBlockedUsers()` | `=> Promise<BlockedUser[]>` | Cache. |

## Errors

| Class | `code` | When |
|---|---|---|
| `ConfigError` | `config_error` | No Supabase config. |
| `TransientAuthError` | `session_missing` | No stored session; nothing was sent. |
| `ProfileRequiredError` | `profile_required` | No cached profile for the session. |
| `InviteNotFoundError` | `invite_not_found` | `joinGroup` code unknown. |
| `MeetupNotSyncedError` | `meetup_not_synced` | Photo before the meetup synced. |
| `ValidationError` | `invalid_input` (+ `field`) | Client-side validation; `message` is user-facing copy. |
| `NotFoundError` | `not_found` | Record missing from the cache. |
| `DataAccessError` | Postgres/PostgREST code, `P0001`, … (+ `status`) | Any failed request. For P0001, `message` is the app code (`not_group_member`, `group_full`, …). |

Helpers: `toUserMessage(error)`, `getErrorCode(error)`, `getAppErrorCode(error)`,
`isAppErrorCode(error, code)`. Auth calls throw supabase-js `AuthApiError` /
`AuthRetryableFetchError`; `toUserMessage` maps those too.

## Sync engine (re-used directly from `@festival/sync-engine`)

`flush()`, `isOnline()`, `getPendingCount()`, `getPendingOperationIds(table)`,
`getFailedOperations()`, `clearFailedOperations()`, `retryParkedOperations()`,
`subscribeToSyncEvents(listener)` (`queued` / `synced` / `failed` / `parked` / `cleared` — invalidate
queries and toast "Couldn't save …" on `failed`). Permanently rejected writes are rolled back in the
cache automatically. An operation that keeps failing transiently is parked after 20 attempts; the
engine's own retries leave it parked, and every `flush()` call (launch, foreground, `TOKEN_REFRESHED`,
sign-in, pull to refresh), a NetInfo offline→online change or `retryParkedOperations()` gives it a
fresh round.

## Tests

`npm run test -w @festival/data-access` (vitest; MMKV/NetInfo are faked, SQLite runs in sql.js and
Supabase is a recorded fake client — no network).
