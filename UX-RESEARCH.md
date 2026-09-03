# UX Research Summary

**Project:** Belfast Accessibility Mapper
**Date:** 2026-09-03
**Prepared by:** Requirements Elicitation Skill (CPUX)

---

## User Profiles

**Wheelchair user, Belfast city centre.** Moves through the city on foot/by chair for everyday journeys (appointments, shopping, errands, meeting people). Uses a mobile phone as their primary — likely only — device for this app. Has two distinct modes of engagement: a calmer, seated "planning" mode before leaving home, and a more urgent, one-handed "in the moment" mode while already navigating the city and physically encountering an obstruction. In the second mode, they may be managing their chair, luggage, or other tasks with their other hand, and may be frustrated or in a hurry to find an alternative route.

## Key Insights

- The core unmet need is **advance warning** — today there is no way to know a route is blocked until physically arriving at the obstruction. Any friction added to checking the map before a trip undermines the core value proposition.
- Reporting must be fast enough to do **one-handed, outdoors, in the moment of frustration** — a long form will not get used. GPS auto-placement + one category tap + optional photo is close to the minimum viable interaction.
- Because there is no verification, **trust is implicit and visual** — users will judge report credibility from the timestamp and category icon, not from any system-provided trust signal. This is accepted as a backlog risk, not solved in MVP.
- The four category icons are the primary scanning mechanism — users will glance at the map and want to instantly tell "is this a lift problem or a pavement problem" without tapping into each pin.

## Mental Models & Domain Language

- Users think in terms of concrete obstacles, not abstract "accessibility scores": **"the lift is out," "that ramp's blocked," "pavement's dug up,"** — this maps directly to the four chosen categories (Lifts, Construction, Blocked Ramps, Blocked Pavement) and the UI should use this plain, concrete language rather than technical or clinical terms.
- "Checking before I go" and "logging something I just found" are two separate mental modes for the same user — the interface should treat these as two clear entry points from the same map view, not force the user to hunt for the reporting action.

## Task Analysis

| Task | Frequency | Stakes | Key friction | Design implication |
|---|---|---|---|---|
| Check map before setting out | High | High (getting stuck mid-journey is the core pain point) | None currently — this is a net-new capability | Map must load fast and show current state immediately on open, no login/setup step |
| Log a new blocker while out | Medium | Medium (helps others, not urgent for self) | One-handed use, outdoor conditions, possible GPS inaccuracy | GPS auto-place + drag-to-refine + one-tap category + optional photo; must be completable in under ~30 seconds |
| Distinguish blocker types at a glance | High | Medium | Users won't tap every pin individually | Distinct custom icon per category, legible at normal map zoom |

## Design Risks

- **GPS inaccuracy** in dense urban areas (tall buildings, narrow streets) could place pins in the wrong spot — mitigated by the drag-to-refine step, but this relies on the user noticing and correcting it; worth a subtle visual cue prompting confirmation of pin placement.
- **No moderation** means a bad-faith or joke report is indistinguishable from a real one — acceptable for a demo, but a real risk if this were ever used beyond a hackathon audience. Flagged in the PRD as an accepted MVP risk, not a solved problem.
- **Icon legibility at a glance** — if the four category icons are too visually similar, the core "scan the map and understand it instantly" value is undermined. Icons should be tested for visual distinctiveness, not just uniqueness in code.
- **Report staleness** — because reports never expire in MVP, the map could show a "blocked ramp" from weeks ago as if it were current, misleading a user in the moment. This is explicitly backlogged, but should be communicated honestly in any demo narrative (e.g., verbally note this is a known next step).

## Usability Test Plan

- **Primary test:** Two people, two separate phones/browsers, both viewing the live map. One logs a new report; confirm the second sees the pin appear within a few seconds without refreshing. Pass = pin appears automatically and promptly; fail = requires manual refresh or does not appear within a reasonable window.
- **Reporting flow test:** Time a first-time user (no instructions) completing a full report (place pin, pick category, submit) outdoors on a phone. Pass = under ~30 seconds without confusion about what to do next.
- **Icon distinguishability test:** Show the four category icons side by side to someone unfamiliar with the app and ask them to identify each one from the icon alone. Pass = all four correctly identified or reasonably inferred.
- **GPS-denied fallback test:** Deny location permission in the browser and attempt to submit a report. Pass = app falls back cleanly to manual tap-to-place-pin without breaking the reporting flow.
