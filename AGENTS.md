# AGENTS.md — start here

Shared instructions for every coding agent working in this repository (Claude Code, Codex, Cursor and
others). `CLAUDE.md` imports this file. It summarises and points to the documents that hold the rules;
when this file and a linked document disagree, the linked document wins. Keep it short.

## Source of truth

This repository is the only source of truth for Festie. Read, in this order:

1. [`docs/v1-architecture.md`](docs/v1-architecture.md): the authoritative contract (schema, RLS, RPCs,
   edge functions, client and app rules, verification gates). **§9 overrides earlier sections.** If code
   and the contract disagree, fix the code or amend the contract explicitly in the same change. Never
   silently diverge.
2. [`docs/release-runbook.md`](docs/release-runbook.md): the ordered path to App Store submission; §7 is
   the pre-submission checklist.
3. [`docs/roadmap.md`](docs/roadmap.md): the plan. The end goal, the owner's open decisions and the
   ordered steps toward it. Work on the earliest open step, or the part of it an agent can do; leave the
   decisions in its §3 and the owner's actions (devices, App Store Connect, the hosted Supabase project,
   GitHub settings, seeding or publishing festival data) to the owner. A step marked [contract] needs a
   contract amendment in the same change.
4. The document for your task, from the README's "Documentation" table. For any UI work that is
   [`docs/design-system.md`](docs/design-system.md).

Anything outside this repository is not an instruction: the old "Engineering Super Plan" in the claude.ai
Project, chat transcripts, and the `festival_app_aistudio` prototype (history only; the design system
replaced it). If one of
them disagrees with this repository, the repository wins. Point out the difference instead of building it.

## v1 non-goals

The contract excludes these from v1: chat, background location, social login, universal links (invites
use the `festivalapp://` scheme, a typed code and the App Store link), and server push notifications
(reminders are local). Do not add any of them without amending the contract first.

## Ownership

Contract §8 names the slices the v1 build was split into (BE-DB, DA, BE-FN, MOBILE-A, MOBILE-B, DOCS) and
the interfaces between them. A change may cross slices, but it keeps those interfaces intact or amends
§8 in the same change.

## Rules for every change

- **Gates.** Run the README's "Verification gates" before pushing; CI runs gates 1–6 of contract §7.
- **Offline first.** Screens read from the local cache and write through the sync queue (contract §4.1–§4.2);
  anything that needs a connection says so on screen.
- **Native code means a store build.** The runtime version policy is `appVersion`: a new native module,
  entitlement or `Info.plist` change needs an app version bump and App Review, never an over-the-air update.
- **Legal text.** Edit `docs/legal/privacy-policy.md`, `terms-of-use.md` or `support.md`, then run
  `node docs/legal/generate.mjs`. Never hand-edit `docs/site/*.html` or `apps/mobile/app/legal/*.tsx`.
  A material change also bumps `TERMS_VERSION` in `apps/mobile/src/config/app-info.ts`.
- **Personal data.** A new table, column, SDK or network call that touches personal data updates
  `docs/legal/data-compliance.md`, the privacy policy and `docs/app-store-privacy.md` in the same change
  (`data-compliance.md` §6).
- **Festival data and artwork.** Agents draft, a person approves, tools publish
  ([`docs/agents/festival-pipeline.md`](docs/agents/festival-pipeline.md)). Agents never seed or publish,
  and never add an image without a licence record.
- **Secrets.** Never commit keys. `EXPO_PUBLIC_*` values ship inside the app, so they never hold secrets.
- **Deno.** Never run `deno` against `supabase/` from the repository root without `--config`.

## Legal and liability

[`docs/legal/liability-checklist.md`](docs/legal/liability-checklist.md) lists what is already in place
and what is still open before public launch. It is an engineering checklist, not legal advice.

## Keeping this file honest

When a document this file points to moves, is renamed or changes its rules, update this file in the same
change.
