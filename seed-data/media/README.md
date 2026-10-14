# Media registry (licensed images)

`registry.json` is the only way an image reaches the Festie app. Festival data itself stays
nominative and artwork-free (docs/festival-data.md §3); artist photos and festival pictures are
allowed only when the registry records where each file came from, under which licence it may be
shown, and who approved it. Files live next to the registry:

```
seed-data/media/
  registry.json              { "version": 1, "entries": [ ... ] }
  artists/<artists.id>.jpg   one file per subject, named after the row id (jpg, png or webp)
  festivals/<festivals.id>.png
```

Schema: `apps/admin-tools/src/media/types.ts` (`MediaEntry`). Each entry has the subject
(`subject_type`, `subject_id`, `subject_name` as a check), the file (`file`, `sha256`, `mime`,
`width`, `height`), its `source` (kind, URL of the file page, the page that led to it, when it was
retrieved, a free-text note), its `license` (id, deed URL, attribution text) and its `review`
(`pending` → `approved` or `rejected`, by whom, when).

## Allowed licences

| `license.id` | Credit required | Notes |
| --- | --- | --- |
| `CC0-1.0`, `public-domain` | no (still recorded when known) | |
| `CC-BY-2.0` … `CC-BY-4.0` | yes | |
| `CC-BY-SA-2.0` … `CC-BY-SA-4.0` | yes | the app only shows the photo; it is not relicensed |
| `organizer-permission` | as agreed | written permission on file, referenced in `source.note` |
| `press-kit-editorial` | as the kit says | link the kit in `source.url` |
| `generated` | no | made by us (e.g. a typographic mark) |

Anything else is refused by `media:validate` and by the Commons fetcher:

- **NC (non-commercial)** licences cannot be used: Festie is a commercial app.
- **ND (no derivatives)** licences cannot be used: the app crops, resizes and renders thumbnails.
- **Unknown or unstated** licences, "all rights reserved", GFDL-only, fair-use and press photos
  without an editorial-use kit are refused. When in doubt, leave the artist without a photo; the app
  falls back to its monogram.

Images of people carry personality rights separate from copyright; the fetcher copies Commons'
`Restrictions` note into `source.note` so the reviewer sees it.

## How attribution is shown

`media:upload` writes `image_url`, `image_credit` (= `license.attribution`), `image_license` and
`image_source_url` on the `artists` / `festivals` row (migration 012). The app shows the photo in the
lineup and the credit on its **Photo credits** screen (Settings), one line per image, linking to the
source page: `Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons`. Attribution text is required
for every `CC-BY*` licence and is at most 300 characters.

## Workflow

1. **Fetch candidates** (optional, Wikimedia Commons via Wikidata; pending entries only):

   ```
   npm run admin -- media:fetch-commons --artist "Four Tet" --artist-id <artists.id> [--wikidata Q…] [--into <dir>]
   npm run admin -- media:fetch-commons --seed seed-data/<festival>.json [--into <dir>] [--limit <n>]
   ```

   The fetcher looks the artist up on Wikidata (keeping hits described as a musician, DJ, band,
   singer, rapper, producer or duo), reads its image (P18), checks the licence on Commons, downloads
   the 512 px thumbnail to `<into>/artists/<id>.<ext>` and appends a **pending** entry. `--into`
   defaults to `seed-data/media`; a candidate bundle uses `seed-data/candidates/<slug>/media`.
   Requests carry a descriptive User-Agent and are spaced at least one second apart. It needs
   internet access to wikidata.org, commons.wikimedia.org and upload.wikimedia.org.

2. **Review.** Open the file and the source page. Check it really shows the artist, that the
   licence on the page matches the entry, and that the credit names the photographer. Then set
   `review.status` to `approved` (with `by` and `at`) or `rejected`. Nothing is uploaded until an
   entry is `approved`; a subject has at most one approved entry.

3. **Validate** (offline):

   ```
   npm run admin -- media:validate [--file <registry>]
   ```

   Checks every rule: version, fields and enums, subject exists in the seed files with the right
   type (a changed name is a warning), file under the registry directory, at most 2 MiB and 512 px,
   sniffed type and `sha256` match, `https` URLs, attribution for CC-BY licences, one approved entry
   per subject, `by`/`at` on approved entries.

4. **Upload** (service role):

   ```
   npm run admin -- media:upload --dry-run
   npm run admin -- media:upload
   ```

   For every approved entry: uploads the file to the public `artwork` bucket (migration 013) at the
   same path when the object is missing or its checksum differs, writes the row's image columns when
   they differ, clears rows whose image points at the bucket without an approved entry, bumps
   `festivals.version` on every published festival whose own image changed or that has a set by an
   artist whose image changed (so clients refetch), and finally removes the cleared subjects' objects
   and any object no approved entry references. Re-run after rejecting an entry to take its image down.

   The bumps come before the removals on purpose. A re-run derives the removals again from the bucket
   listing (a failed removal is only a warning), but it would not plan the bumps again once the rows
   are current. If a run fails between its first row write and its last bump, the error lists the
   festivals left to bump; `festival:seed seed-data/<slug>.json` bumps each of them.

   Re-uploading under the same path keeps the same URL; the Supabase CDN may serve the previous bytes
   for up to an hour (`cache-control: max-age=3600`).
