import { enqueue, getDb, upsertRows, withDbTransaction } from '@festival/sync-engine';

import {
  GROUP_COLUMNS,
  MEETUP_COLUMNS,
  MEMBER_COLUMNS,
  SELECTION_COLUMNS,
  USER_PUBLIC_COLUMNS,
  createChangeTracker,
  mergeOwnSelections,
  placeholders,
  pruneOrphanedMembers,
  purgeGroupLocally,
  purgeGroupRows,
  replaceMemberSelections,
  withGroupGuard,
  withRefreshGuard,
} from './cache';
import { InviteNotFoundError, NotFoundError, ValidationError, toDataAccessError } from './errors';
import { createId } from './ids';
import { readOptionalRow, selectAllRows, selectAllRowsIn } from './paging';
import type { Group, GroupMember, GroupMemberRow, LocalMeetup, PublicUser, UserSetSelectionRow } from './models';
import { getCachedProfile, requireCachedProfile, textLength } from './profile';
import { requireStoredSession } from './session';
import { callRpc, getSupabase, requireRpcRows, unwrapResult } from './supabase';

export const GROUP_NAME_MAX_LENGTH = 60;
export const MEETUP_TITLE_MAX_LENGTH = 80;
export const MEETUP_NOTES_MAX_LENGTH = 500;
export const GROUP_MAX_MEMBERS = 50;
const INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export interface GroupSummary extends Group {
  /** The signed-in user's role in the group. */
  my_role: string;
  member_count: number;
}

export interface GroupDetail {
  group: Group;
  my_role: string | null;
  members: GroupMember[];
  /** Meetups, excluding ones created by users the signed-in user blocked. */
  meetups: LocalMeetup[];
}

export interface CreatedGroup {
  group_id: string;
  name: string;
  festival_id: string;
  invite_code: string;
}

export interface JoinedGroup {
  group_id: string;
  group_name: string;
  festival_id: string;
  member_count: number;
}

export interface CombinedSelectionRow extends UserSetSelectionRow {
  artist_name: string;
  stage_name: string;
  start_time: string;
  end_time: string;
  /** The set's schedule status: 'scheduled' | 'moved' | 'cancelled'. */
  status: string;
  original_start_time: string | null;
  change_note: string | null;
  member_display_name: string;
  member_avatar_type: string;
  member_avatar_value: string;
}

export interface MeetupInput {
  group_id: string;
  title: string;
  /** ISO timestamp. */
  starts_at: string;
  stage_id?: string | null;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type MeetupPatch = Partial<Omit<MeetupInput, 'group_id'>>;

type Rows = Array<Record<string, unknown>>;

function validateGroupName(name: string): string {
  const trimmed = name.trim();
  if (textLength(trimmed) < 1) {
    throw new ValidationError('Give your crew a name.', 'name');
  }
  if (textLength(trimmed) > GROUP_NAME_MAX_LENGTH) {
    throw new ValidationError(`Crew names can be at most ${GROUP_NAME_MAX_LENGTH} characters.`, 'name');
  }
  return trimmed;
}

/** Uppercases and strips everything but letters/digits, as the server does. */
export function normaliseInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isWellFormedInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(normaliseInviteCode(code));
}

// ---- Local reads -----------------------------------------------------------------------------

/** The signed-in user's groups from the local cache, newest first. */
export async function getLocalGroups(): Promise<GroupSummary[]> {
  const profile = getCachedProfile();
  if (!profile) {
    return [];
  }

  const db = await getDb();
  return db.getAllAsync<GroupSummary>(
    `SELECT groups.id, groups.festival_id, groups.name, groups.created_by_user_id, groups.invite_code,
            groups.invite_code_rotated_at, groups.created_at, mine.role AS my_role,
            (SELECT COUNT(*) FROM group_members WHERE group_members.group_id = groups.id) AS member_count
     FROM groups
     INNER JOIN group_members AS mine ON mine.group_id = groups.id AND mine.user_id = ?
     ORDER BY groups.created_at DESC;`,
    [profile.id],
  );
}

/** A cached group with members and meetups, or `null` when it is not cached. */
export async function getLocalGroupDetail(groupId: string): Promise<GroupDetail | null> {
  const db = await getDb();
  const group = await db.getFirstAsync<Group>(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = ?;`, [groupId]);
  if (!group) {
    return null;
  }

  const memberRows = await db.getAllAsync<
    GroupMemberRow & { display_name: string | null; avatar_type: string | null; avatar_value: string | null; user_created_at: string | null; blocked: number }
  >(
    `SELECT group_members.id, group_members.group_id, group_members.user_id, group_members.role, group_members.joined_at,
            users.display_name, users.avatar_type, users.avatar_value, users.created_at AS user_created_at,
            CASE WHEN user_blocks.blocked_id IS NULL THEN 0 ELSE 1 END AS blocked
     FROM group_members
     LEFT JOIN users ON users.id = group_members.user_id
     LEFT JOIN user_blocks ON user_blocks.blocked_id = group_members.user_id
     WHERE group_members.group_id = ?
     ORDER BY group_members.joined_at ASC;`,
    [groupId],
  );

  const members: GroupMember[] = memberRows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    is_blocked: Number(row.blocked) === 1,
    user:
      row.display_name !== null
        ? {
            id: row.user_id,
            display_name: row.display_name,
            avatar_type: row.avatar_type ?? 'initials',
            avatar_value: row.avatar_value ?? '',
            created_at: row.user_created_at,
          }
        : null,
  }));

  const me = getCachedProfile()?.id;
  return {
    group,
    my_role: members.find((member) => member.user_id === me)?.role ?? null,
    members,
    meetups: await getLocalMeetups(groupId),
  };
}

/** Cached meetups of a group (soonest first), excluding meetups by blocked users. */
export async function getLocalMeetups(groupId: string): Promise<LocalMeetup[]> {
  const db = await getDb();
  return db.getAllAsync<LocalMeetup>(
    `SELECT ${MEETUP_COLUMNS}, pending_sync, synced_at FROM meetups
     WHERE group_id = ? AND created_by_user_id NOT IN (SELECT blocked_id FROM user_blocks)
     ORDER BY starts_at ASC;`,
    [groupId],
  );
}

export async function getLocalMeetup(meetupId: string): Promise<LocalMeetup | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalMeetup>(`SELECT ${MEETUP_COLUMNS}, pending_sync, synced_at FROM meetups WHERE id = ?;`, [meetupId]);
}

/** Every member's cached selections for the group's festival, excluding blocked users. */
export async function getCombinedSelections(groupId: string, festivalId: string): Promise<CombinedSelectionRow[]> {
  const db = await getDb();
  return db.getAllAsync<CombinedSelectionRow>(
    `SELECT user_set_selections.id, user_set_selections.user_id, user_set_selections.festival_id, user_set_selections.set_id,
            user_set_selections.selected_at, user_set_selections.note,
            artists.name AS artist_name, stages.name AS stage_name,
            sets.start_time AS start_time, sets.end_time AS end_time,
            sets.status AS status, sets.original_start_time AS original_start_time, sets.change_note AS change_note,
            COALESCE(users.display_name, 'Festie user') AS member_display_name,
            COALESCE(users.avatar_type, 'initials') AS member_avatar_type,
            COALESCE(users.avatar_value, '') AS member_avatar_value
     FROM user_set_selections
     INNER JOIN group_members ON group_members.user_id = user_set_selections.user_id AND group_members.group_id = ?
     INNER JOIN sets ON sets.id = user_set_selections.set_id
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     LEFT JOIN users ON users.id = user_set_selections.user_id
     WHERE user_set_selections.festival_id = ?
       AND user_set_selections.user_id NOT IN (SELECT blocked_id FROM user_blocks)
     ORDER BY sets.start_time ASC;`,
    [groupId, festivalId],
  );
}

// ---- Refresh (online) --------------------------------------------------------------------------

/**
 * Groups written locally (created, joined or refreshed) while a `listMyGroups` is in flight. Its
 * membership snapshot may predate those writes, so it must not purge them as stale.
 */
const groupWrites = createChangeTracker();

/**
 * Groups changed by a direct online write (left, member removed, renamed, invite code rotated) while a
 * `listMyGroups` or `refreshGroupDetail` is in flight. Their local state is newer than the refresh's
 * snapshot, so the refresh must not write them back.
 */
const groupChanges = createChangeTracker();

async function fetchPublicUsers(userIds: string[]): Promise<PublicUser[]> {
  const client = getSupabase();
  return selectAllRowsIn<PublicUser>(userIds, (ids, options) =>
    client.from('users').select(USER_PUBLIC_COLUMNS, options).in('id', ids).order('id', { ascending: true }),
  );
}

/**
 * Refreshes the signed-in user's groups and replaces the local copy: memberships the server no longer
 * returns are deleted locally, together with groups nobody references any more. A group created, joined
 * or refreshed locally while this refresh was in flight is kept (its snapshot may predate it), and a
 * group left, renamed or changed by an admin action meanwhile keeps its local state.
 */
export async function listMyGroups(): Promise<GroupSummary[]> {
  const profile = requireCachedProfile();
  requireStoredSession();
  const client = getSupabase();

  await groupWrites.track((writtenDuringRefresh) =>
    groupChanges.track((changedDuringRefresh) =>
      withRefreshGuard(async (guard) => {
        // Every read is paged: PostgREST caps each response at `max_rows` without an error, and rows
        // missing from these results are deleted locally.
        const membershipRows = await selectAllRows<GroupMemberRow & { groups: Group | null }>((options) =>
          client
            .from('group_members')
            .select(`${MEMBER_COLUMNS}, groups(${GROUP_COLUMNS})`, options)
            .eq('user_id', profile.id)
            .order('id', { ascending: true }),
        );

        const memberships = membershipRows.filter((row) => row.groups);
        const groups = memberships.map((row) => row.groups as Group);
        const groupIds = groups.map((group) => group.id);

        const members = await selectAllRowsIn<GroupMemberRow>(groupIds, (ids, options) =>
          client.from('group_members').select(MEMBER_COLUMNS, options).in('group_id', ids).order('id', { ascending: true }),
        );
        const users = await fetchPublicUsers([...new Set(members.map((member) => member.user_id))]);

        await withDbTransaction(async (tx) => {
          if (guard.stale) {
            return;
          }
          // Groups changed locally since the fetch started keep their (newer) local state: a left crew
          // stays gone, a removed member stays removed. Their ids still count as current below.
          const isCurrent = (groupId: string) => !changedDuringRefresh.has(groupId);
          await upsertRows('groups', groups.filter((group) => isCurrent(group.id)) as unknown as Rows, tx);

          const staleGroups = await tx.getAllAsync<{ id: string }>(
            groupIds.length
              ? `SELECT id FROM groups WHERE id NOT IN (${placeholders(groupIds.length)});`
              : 'SELECT id FROM groups;',
            groupIds,
          );
          for (const { id } of staleGroups) {
            if (!writtenDuringRefresh.has(id)) {
              await purgeGroupRows(tx, id);
            }
          }

          for (const groupId of groupIds.filter(isCurrent)) {
            const groupMembers = members.filter((member) => member.group_id === groupId);
            const memberIds = groupMembers.map((member) => member.id);
            await tx.runAsync(
              memberIds.length
                ? `DELETE FROM group_members WHERE group_id = ? AND id NOT IN (${placeholders(memberIds.length)});`
                : 'DELETE FROM group_members WHERE group_id = ?;',
              [groupId, ...memberIds],
            );
          }

          const ownRows = memberships.map(({ groups: _group, ...membership }) => membership);
          await upsertRows(
            'group_members',
            [...members, ...ownRows].filter((member) => isCurrent(member.group_id)) as unknown as Rows,
            tx,
          );
          await upsertRows('users', users as unknown as Rows, tx);
          await pruneOrphanedMembers(tx);
        });
      }),
    ),
  );

  return getLocalGroups();
}

/**
 * Refreshes one group (group, members, profiles, meetups, members' selections for its festival).
 * Resolves `null` — after purging it locally — when the user is no longer a member. If the group is
 * left, renamed or changed by an admin action while the fetch is in flight, the fetched snapshot is
 * older than the local state and nothing is written.
 */
export async function refreshGroupDetail(groupId: string): Promise<GroupDetail | null> {
  const profile = requireCachedProfile();
  requireStoredSession();

  return withGroupGuard(groupId, () =>
    groupChanges.track((changedDuringRefresh) =>
      withRefreshGuard(async (guard) => {
        const client = getSupabase();
        // The count tells PostgREST's "no such group" (count 0) apart from an empty reply from something
        // else, which must not purge the crew.
        const group = readOptionalRow<Group>(
          await client.from('groups').select(GROUP_COLUMNS, { count: 'exact' }).eq('id', groupId).maybeSingle(),
        );
        if (!group) {
          await purgeGroupLocally(groupId);
          return null;
        }

        // Every read is paged: PostgREST caps each response at `max_rows` without an error, and the merge
        // below deletes local rows missing from these results (50 members' selections easily exceed it).
        const members = await selectAllRows<GroupMemberRow>((options) =>
          client.from('group_members').select(MEMBER_COLUMNS, options).eq('group_id', groupId).order('id', { ascending: true }),
        );
        const userIds = [...new Set(members.map((member) => member.user_id))];
        const users = await fetchPublicUsers(userIds);
        const meetups = await selectAllRows<LocalMeetup>((options) =>
          client.from('meetups').select(MEETUP_COLUMNS, options).eq('group_id', groupId).order('id', { ascending: true }),
        );
        const selections = await selectAllRowsIn<UserSetSelectionRow>(userIds, (ids, options) =>
          client
            .from('user_set_selections')
            .select(SELECTION_COLUMNS, options)
            .eq('festival_id', group.festival_id)
            .in('user_id', ids)
            .order('id', { ascending: true }),
        );

        await withDbTransaction(async (tx) => {
          if (guard.stale || changedDuringRefresh.has(groupId)) {
            return;
          }
          // Meetups with queue activity that may postdate the fetch keep their local state.
          const protectedMeetupIds = await guard.protectedMeetupIds(tx);
          groupWrites.note(groupId);
          await upsertRows('groups', [group as unknown as Record<string, unknown>], tx);

          const memberIds = members.map((member) => member.id);
          await tx.runAsync(
            memberIds.length
              ? `DELETE FROM group_members WHERE group_id = ? AND id NOT IN (${placeholders(memberIds.length)});`
              : 'DELETE FROM group_members WHERE group_id = ?;',
            [groupId, ...memberIds],
          );
          await upsertRows('group_members', members as unknown as Rows, tx);
          await upsertRows('users', users as unknown as Rows, tx);

          const remoteMeetupIds = new Set(meetups.map((meetup) => meetup.id));
          const localMeetups = await tx.getAllAsync<{ id: string }>('SELECT id FROM meetups WHERE group_id = ?;', [groupId]);
          for (const { id } of localMeetups) {
            if (!remoteMeetupIds.has(id) && !protectedMeetupIds.has(id)) {
              await tx.runAsync('DELETE FROM meetups WHERE id = ?;', [id]);
            }
          }
          const syncedAt = new Date().toISOString();
          await upsertRows(
            'meetups',
            meetups.filter((meetup) => !protectedMeetupIds.has(meetup.id)).map((meetup) => ({ ...meetup, pending_sync: 0, synced_at: syncedAt })),
            tx,
          );

          for (const userId of userIds) {
            const rows = selections.filter((selection) => selection.user_id === userId);
            if (userId === profile.id) {
              await mergeOwnSelections(tx, userId, group.festival_id, rows, await guard.protectedSelectionSetIds(tx, userId));
            } else {
              await replaceMemberSelections(tx, userId, group.festival_id, rows);
            }
          }

          await pruneOrphanedMembers(tx);
        });

        return getLocalGroupDetail(groupId);
      }),
    ),
  );
}

// ---- Group RPCs --------------------------------------------------------------------------------

/** Creates a crew for a published festival (RPC `create_group`); the creator becomes admin. */
export async function createGroup(input: { name: string; festival_id: string }): Promise<CreatedGroup> {
  const name = validateGroupName(input.name);
  const profile = requireCachedProfile();
  const created = requireRpcRows(await callRpc('create_group', { p_name: name, p_festival_id: input.festival_id }))[0];
  if (!created) {
    throw toDataAccessError({ code: 'P0001', message: 'festival_not_found' }, 400);
  }

  const now = new Date().toISOString();
  groupWrites.note(created.group_id);
  await withDbTransaction(async (tx) => {
    await upsertRows(
      'groups',
      [
        {
          id: created.group_id,
          festival_id: created.festival_id,
          name: created.name,
          created_by_user_id: profile.id,
          invite_code: created.invite_code,
          created_at: now,
        },
      ],
      tx,
    );
    const existing = await tx.getFirstAsync('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?;', [created.group_id, profile.id]);
    if (!existing) {
      await upsertRows(
        'group_members',
        [{ id: createId(), group_id: created.group_id, user_id: profile.id, role: 'admin', joined_at: now }],
        tx,
      );
    }
  });
  await refreshGroupDetail(created.group_id).catch(() => undefined);

  return { group_id: created.group_id, name: created.name, festival_id: created.festival_id, invite_code: created.invite_code };
}

/**
 * Joins a crew by invite code (RPC `join_group`). Throws `InviteNotFoundError` when no group has that
 * code; P0001 `group_full` / `rate_limited` surface as `DataAccessError`.
 */
export async function joinGroup(inviteCode: string): Promise<JoinedGroup> {
  const code = normaliseInviteCode(inviteCode);
  if (code.length === 0) {
    throw new ValidationError('Enter an invite code.', 'invite_code');
  }

  requireCachedProfile();
  const joined = requireRpcRows(await callRpc('join_group', { p_invite_code: code }))[0];
  if (!joined) {
    throw new InviteNotFoundError();
  }

  await refreshGroupDetail(joined.group_id).catch(() => undefined);
  return {
    group_id: joined.group_id,
    group_name: joined.group_name,
    festival_id: joined.festival_id,
    member_count: Number(joined.member_count),
  };
}

/** Leaves a crew (RPC `leave_group`) and removes it locally. */
export async function leaveGroup(groupId: string): Promise<void> {
  await withGroupGuard(groupId, () => callRpc('leave_group', { p_group_id: groupId }));
  groupChanges.note(groupId);
  await purgeGroupLocally(groupId);
}

/** Admin: removes a member (RPC `remove_group_member`). */
export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await withGroupGuard(groupId, () => callRpc('remove_group_member', { p_group_id: groupId, p_user_id: userId }));
  groupChanges.note(groupId);
  await withDbTransaction(async (tx) => {
    await tx.runAsync('DELETE FROM group_members WHERE group_id = ? AND user_id = ?;', [groupId, userId]);
    await pruneOrphanedMembers(tx);
  });
}

/** Admin: replaces the invite code (RPC `rotate_invite_code`); resolves the new code. */
export async function rotateInviteCode(groupId: string): Promise<string> {
  const code = await withGroupGuard(groupId, () => callRpc('rotate_invite_code', { p_group_id: groupId }));
  groupChanges.note(groupId);
  const db = await getDb();
  await db.runAsync('UPDATE groups SET invite_code = ?, invite_code_rotated_at = ? WHERE id = ?;', [code, new Date().toISOString(), groupId]);
  return code;
}

/** Admin: renames a crew (direct update; RLS limits it to admins). */
export async function renameGroup(groupId: string, name: string): Promise<void> {
  const validName = validateGroupName(name);
  requireStoredSession();
  await withGroupGuard(groupId, async () => {
    const updated = unwrapResult(await getSupabase().from('groups').update({ name: validName }).eq('id', groupId).select('id')) ?? [];
    if (updated.length === 0) {
      throw toDataAccessError({ code: 'P0001', message: 'not_group_admin' }, 400);
    }
  });
  groupChanges.note(groupId);
  const db = await getDb();
  await db.runAsync('UPDATE groups SET name = ? WHERE id = ?;', [validName, groupId]);
}

// ---- Meetups (offline queue) -----------------------------------------------------------------

function normaliseMeetupFields(input: Omit<MeetupInput, 'group_id'>): Omit<MeetupInput, 'group_id'> {
  const title = input.title.trim();
  if (textLength(title) < 1) {
    throw new ValidationError('Give the meetup a title.', 'title');
  }
  if (textLength(title) > MEETUP_TITLE_MAX_LENGTH) {
    throw new ValidationError(`Meetup titles can be at most ${MEETUP_TITLE_MAX_LENGTH} characters.`, 'title');
  }

  const notes = input.notes?.trim() || null;
  if (notes && textLength(notes) > MEETUP_NOTES_MAX_LENGTH) {
    throw new ValidationError(`Notes can be at most ${MEETUP_NOTES_MAX_LENGTH} characters.`, 'notes');
  }

  if (Number.isNaN(Date.parse(input.starts_at))) {
    throw new ValidationError('Pick a time for the meetup.', 'starts_at');
  }

  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) {
    throw new ValidationError('A meetup pin needs both latitude and longitude.', 'location');
  }
  if (latitude !== null && longitude !== null) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ValidationError('That meetup pin is not a valid location.', 'location');
    }
  }

  return {
    title,
    notes,
    starts_at: new Date(input.starts_at).toISOString(),
    stage_id: input.stage_id ?? null,
    latitude,
    longitude,
  };
}

/** Creates a meetup locally and queues it for sync. Resolves the optimistic local row. */
export async function createMeetup(input: MeetupInput): Promise<LocalMeetup> {
  const fields = normaliseMeetupFields(input);
  const profile = requireCachedProfile();
  const now = new Date().toISOString();
  const meetup: LocalMeetup = {
    id: createId(),
    group_id: input.group_id,
    title: fields.title,
    stage_id: fields.stage_id ?? null,
    starts_at: fields.starts_at,
    notes: fields.notes ?? null,
    latitude: fields.latitude ?? null,
    longitude: fields.longitude ?? null,
    totem_path: null,
    created_by_user_id: profile.id,
    created_at: now,
    updated_at: now,
    pending_sync: 1,
    synced_at: null,
  };

  const { pending_sync: _pending, synced_at: _synced, ...payload } = meetup;
  await enqueue({ table: 'meetups', type: 'upsert', payload, created_at: now });
  return meetup;
}

/**
 * Edits a meetup the signed-in user created (queued as an `update`: if the meetup is deleted on the
 * server before the edit syncs, the edit is dropped together with the local row — it never re-creates
 * the meetup).
 */
export async function updateMeetup(meetupId: string, patch: MeetupPatch): Promise<LocalMeetup> {
  const profile = requireCachedProfile();
  const existing = await getLocalMeetup(meetupId);
  if (!existing) {
    throw new NotFoundError('That meetup is no longer available.');
  }
  if (existing.created_by_user_id !== profile.id) {
    throw new ValidationError('Only the person who created a meetup can edit it.', 'meetup');
  }

  const fields = normaliseMeetupFields({
    title: patch.title ?? existing.title,
    starts_at: patch.starts_at ?? existing.starts_at,
    stage_id: patch.stage_id !== undefined ? patch.stage_id : existing.stage_id,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    latitude: patch.latitude !== undefined ? patch.latitude : existing.latitude,
    longitude: patch.longitude !== undefined ? patch.longitude : existing.longitude,
  });
  const now = new Date().toISOString();
  const updated: LocalMeetup = {
    ...existing,
    title: fields.title,
    starts_at: fields.starts_at,
    stage_id: fields.stage_id ?? null,
    notes: fields.notes ?? null,
    latitude: fields.latitude ?? null,
    longitude: fields.longitude ?? null,
    updated_at: now,
    pending_sync: 1,
    synced_at: null,
  };

  const { pending_sync: _pending, synced_at: _synced, ...payload } = updated;
  await enqueue({ table: 'meetups', type: 'update', payload, created_at: now });
  return updated;
}

/**
 * Deletes a meetup (creator, or a group admin) through the queue. When the delete reaches the server —
 * now or after coming back online — the sync transport also removes the meetup's totem photo.
 */
export async function deleteMeetup(meetupId: string): Promise<void> {
  requireCachedProfile();
  const existing = await getLocalMeetup(meetupId);
  if (!existing) {
    return;
  }

  await enqueue({ table: 'meetups', type: 'delete', payload: { id: meetupId } });
}
