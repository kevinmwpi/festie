# Liability checklist: Festie v1

Last reviewed: October 13, 2026, against the v1 code on this branch.

**This is an engineering checklist, not legal advice.** It records what limits Festie's legal exposure,
what is already in place and what is still open. A lawyer should review the open items before public
launch (L8).

The aim is not "never sued": anyone can file a claim. The aim is that a claim is unlikely, cheap to end,
and cannot reach the operator's personal assets.

## 1. In place

| Protection | Where |
|---|---|
| Terms of Use: "as is" disclaimer (§11), liability limited to 50 US dollars (§12), 13+ with a parent's permission under the age of majority (§2), not a safety tool (§7), independent of every festival (§8), Texas law and Dallas County courts (§14), Apple Standard EULA terms (§15), a narrow licence to user content (§5) | [`terms-of-use.md`](./terms-of-use.md) |
| The Terms are accepted in the app before any crew content, and again whenever `TERMS_VERSION` changes | `apps/mobile/app/auth/accept-terms.tsx`, `apps/mobile/src/providers/terms-acceptance.ts` |
| A privacy policy backed by a data inventory that maps every statement to code and tests | [`privacy-policy.md`](./privacy-policy.md), [`data-compliance.md`](./data-compliance.md), [`../app-store-privacy.md`](../app-store-privacy.md) |
| Account deletion in the app and by email | `supabase/functions/delete-account`, privacy policy §6, runbook §8.2 |
| Moderation: word filter, report, block and remove, reports reviewed within 24 hours | Terms §1 and §6, runbook §8.1 |
| Festival content: facts from official sources with a recorded `source_url`; names used only to identify; no logos, posters or official maps; images only with a licence record and an in-app credit | [`ip-review.md`](./ip-review.md), [`../agents/festival-pipeline.md`](../agents/festival-pipeline.md) §1, contract §9.8 |
| Security controls with automated tests | [`security-audit.md`](./security-audit.md), `supabase/tests/rls.sql` |
| One source for the legal text, generated into the app and the website and checked in CI | `generate.mjs`, `docs/site/`, runbook §4 |

## 2. Open items

**Due:** *Submission* means before submitting to App Review (runbook §7.2). *Public launch* means before
releasing the approved build (runbook §6 chooses a manual release). *Ongoing* means every time it applies.

| # | Item | Why it matters | Due |
|---|---|---|---|
| L1 | **Decide whether to operate through an LLC.** If yes: form it, open a separate bank account for it, get a D-U-N-S number, convert the Apple Developer membership from individual to organization, then change the legal name in the Terms and the Privacy Policy (runbook §7.1), regenerate and bump `TERMS_VERSION` | The Terms, the Privacy Policy and the App Store seller name all name Kevin Pi personally, so a claim against Festie reaches personal assets. After launch the same change means a Terms change that every user must accept again | Decide before submission; finish before public launch |
| L2 | **Trademark search for "Festie"**, recorded in [`ip-review.md`](./ip-review.md) §3 | A conflicting mark found after launch forces a rename. Already a runbook §7.2 gate | Submission |
| L3 | **Decide the EU trader status** (`__DSA_TRADER_STATUS__`, runbook §6 step 5) | A trader's contact details are shown publicly on the EU App Store page. Use a business address (L1) or leave the EU out at first | Submission |
| L4 | **Update [`ip-review.md`](./ip-review.md) for migrations 012–013** | It still says v1 shows no artist photos. Since 012–013 the app shows licensed artist and festival images with credits (contract §9.8). App Store Connect's content-rights answer (runbook §6 step 1) relies on that review | Submission |
| L5 | **Register a DMCA designated agent** with the US Copyright Office (renew every three years), name it on the support page, and add a copyright-complaint section and a repeat-infringer rule to the Terms | The US safe harbour for user uploads (totem photos) requires a registered agent. Today complaints only go to the support email ([`ip-review.md`](./ip-review.md) §2) | Public launch |
| L6 | **Keep a server-side record of Terms acceptance** (account, `TERMS_VERSION`, time) | Acceptance is stored only in MMKV on the phone ([`data-compliance.md`](./data-compliance.md) §2), so Festie holds no record of who agreed to which version. Needs a contract amendment, a migration, and an update to the data inventory and the privacy policy | Public launch |
| L7 | **Write an incident-response procedure** (a section in [`security-audit.md`](./security-audit.md) or runbook §8): contain and rotate keys (runbook §2.3), find what data was exposed and whose, notify affected people and, where required, regulators within state deadlines (Texas has its own) | No breach procedure exists. Notification deadlines run from discovery, not from when you are ready | Public launch |
| L8 | **Flat-fee lawyer review** of the Terms, the Privacy Policy, this checklist and the questions in §3 | Live location sharing ships in v1, so this cannot wait for a later phase | Public launch |
| L9 | **Store listing and marketing copy describe features and never promise safety or outcomes** | Copy such as "never lose your friends" or "stay safe" contradicts Terms §7 and becomes evidence in a claim | Ongoing, at every listing update |
| L10 | **Insurance:** technology errors and omissions, and cyber liability | It pays for a defence when a claim comes anyway | After launch, before revenue or rapid growth |

## 3. Questions for the lawyer (L8)

- **Indemnity:** should the Terms add a clause in which users cover claims caused by their content or
  conduct?
- **Arbitration or courts:** keep Dallas County courts (Terms §14), or add arbitration with a class-action
  waiver? Arbitration is not free protection: the business usually pays most of the fees, and mass
  filings can be used against it. Courts plus the 50-dollar cap is a defensible default for a free app.
- **Artist photos:** Creative Commons licences cover copyright only, not an artist's publicity or
  personality rights or any trademark. Is showing a licensed photo to identify an artist acceptable?
- **Location sharing:** is Terms §7 enough for the risks of showing a person's position to their crew?
- **Seller identity:** individual or LLC (L1), and the EU trader declaration (L3).

## 4. Keeping this current

- When an item closes, move it to §1 with a link to what closed it: the commit, the registration record
  or the decision.
- Review this file with the [`data-compliance.md`](./data-compliance.md) §6 checklist each release, and
  whenever a feature adds data collection ([`../roadmap.md`](../roadmap.md) §5).
- Material changes to the legal text follow runbook §9: edit the Markdown, regenerate, republish the
  pages, bump `TERMS_VERSION` and ship a build.
