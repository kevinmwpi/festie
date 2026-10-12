# Head Trip 2026: published schedule and weather changes

`head-trip-2026-csv/` (converted to `head-trip-2026.json`) holds the schedule **as originally
published**: one main stage, nine sets, Saturday 10 and Sunday 11 October 2026 at the Empire Polo Club
in Indio, California (Goldenvoice). It is a draft. Publishing it shows a festival that has already
happened, so treat it as real test data, not launch content.

What happened on the weekend is recorded below and is not in the file, because the app has no way to
show a moved or cancelled set yet (see the end of this note). Times are festival local time
(America/Los_Angeles, PDT).

## Sources and how sure we are

Researched on 2026-10-12 from web search results. Direct page reads were not possible from the research
environment, so every fact comes from search excerpts of the pages listed. Re-check against the
official set-times page (`source_url`) or the official Head Trip app before publishing.

- **Original schedule:** several independent copies of the organizer's set-time graphic agree
  (LineupScout, Festival Dust, Desert Luxury Estates, Orange County EDM, EDM Identity). The official
  page `https://headtripindio.com/set-times/` could not be read.
- **Not included:** the Sunflower Sound System dome. Its acts (Floating Points, Four Tet, Avalon
  Emerson, Ben UFO, Eris Drew & Octo Octa, Mad Professor, Theo Parrish, Zach Cowie) were announced, but
  no per-act times were found, only the dome's opening hours.
- **No stage name:** none was found for the main stage, so it is called "Main Stage".

## Timeline of changes

| When | What changed | Confidence | Sources |
|---|---|---|---|
| Sat 10 Oct, afternoon | The organizer adjusted Saturday for expected lightning: gates moved from 15:00 to 16:00, the curfew moved from 01:00 to 23:00, and Calvin Harris was brought forward (Billboard alone gives 21:30). No other revised Saturday times were found. | High for gates and curfew, low for 21:30 | [KESQ](https://kesq.com/news/top-stories/2026/10/10/head-trip-adjusts-set-times-due-to-expected-lightning/), [NBC Palm Springs](https://www.nbcpalmsprings.com/local-and-community/2026/10/10/head-trip-festival-delays-start-time-in-la-quinta-due-to-lightning-concerns-calvin-harris-to-perform-earlier), [Billboard](https://www.billboard.com/music/music-news/head-trip-2026-ends-early-weather-1236358640/) |
| Sat 10 Oct, about 21:00 | Show suspended for lightning during Under Construction (FISHER & Chris Lake). The grounds were cleared. Seth Troxler b2b Ben Sterling and Peggy Gou b2b Four Tet had already played; their actual clock times were not reported. | High | [ABC7](https://abc7.com/story/head-trip-music-festival-ends-show-early-due-lightning-indio-california/19928877/), [NBC Los Angeles](https://www.nbclosangeles.com/news/local/head-trip-festival-show-suspended-severe-weather/3954266/), [Billboard](https://www.billboard.com/music/music-news/head-trip-2026-ends-early-weather-1236358640/) |
| Sat 10 Oct, just before 21:30 | The organizer announced in its app that the show would not resume. The rest of Saturday, including Calvin Harris's headline set, did not happen. | High | [Yahoo / Desert Sun live updates](https://www.yahoo.com/entertainment/music/articles/head-trip-festival-live-updates-001415560.html), [KESQ](https://kesq.com/news/2026/10/11/head-trip-to-resume-sunday-calvin-harris-added-to-lineup/) |
| Sun 11 Oct | The organizer released a new Sunday schedule. Calvin Harris was added at 21:10–22:40, and Swedish House Mafia moved from 22:30 to 23:00 and was cut to about an hour. Earlier sets moved **earlier**, not later: DJ Harvey 15:30 to 15:05, Dom Dolla b2b KETTAMA 18:50 to 18:15, Skrillex 20:40 to 19:35. No revised end times were found except Calvin Harris's. | High for Calvin Harris, Swedish House Mafia's 23:00 start and DJ Harvey; medium for Dom Dolla b2b KETTAMA and Skrillex (We Rave You only) | [Yahoo / Desert Sun](https://www.yahoo.com/entertainment/music/articles/head-trip-festival-live-updates-001415560.html), [KESQ](https://kesq.com/news/2026/10/11/head-trip-to-resume-sunday-calvin-harris-added-to-lineup/), [Billboard](https://www.billboard.com/music/music-news/calvin-harris-added-head-trip-day-two-lineup-coachella-1236358733/), [We Rave You](https://weraveyou.com/2026/10/head-trip-day-1-cancelled-lightning-day-2-calvin-harris-swedish-house-mafia/) |
| Sun 11 Oct, time unknown | The Blessed Madonna withdrew ("unforeseen circumstances"), and Peggy Gou replaced her. No slot time was given. | Low: one source | [Yahoo / Desert Sun](https://www.yahoo.com/entertainment/music/articles/head-trip-festival-live-updates-001415560.html) |

## Entering a change later

Set ids come from festival + artist + festival day (`docs/festival-data.md` §2). Moving a set to
another **day** therefore gives it a new id and deletes users' picks of the old one. To keep picks
when an act moves days (Calvin Harris, Saturday to Sunday), put the old id in the `id` column of
`sets.csv`. Today the app cannot show a cancelled or moved set: a moved set just shows its new time,
and a removed set disappears together with users' picks of it. A set status and short change note
would let it say "Moved from Saturday (weather)" or "Cancelled", which is what this festival needed.
