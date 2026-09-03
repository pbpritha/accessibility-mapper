# Product Requirements Document

**Project:** Belfast Accessibility Mapper
**Version:** 1.0
**Date:** 2026-09-03
**Prepared by:** Requirements Elicitation Skill
**Status:** Draft - Awaiting stakeholder sign-off

---

## 1. Overview

### 1.1 Purpose

Belfast Accessibility Mapper is a crowd-sourced, live map that shows wheelchair users where accessibility features (lifts, ramps, pavements) are currently broken or obstructed in Belfast city centre. Users can check the map before setting off on a journey, and log new problems in real time while out and about, so the map stays current for everyone.

### 1.2 Success Criteria

For the 3-hour hackathon build, success is demonstrated live: a user reports a new blocker on one device, and it appears automatically — without refreshing — on a second, independently connected device within a few seconds. This proves the app is a genuinely shared, real-time experience rather than a single-user tool.

### 1.3 Background

Wheelchair users currently have no way to know whether a ramp, lift, or stretch of pavement is out of service until they physically arrive and get stuck. There is no existing tool, official or informal, that surfaces this information in advance or in the moment. This project is a first, deliberately minimal attempt to close that gap using crowd-sourced reporting.

---

## 2. Users

| User type | Description | Primary goal | Key frustration today |
|---|---|---|---|
| Wheelchair user (Belfast city centre) | A person using a wheelchair who moves through Belfast city centre on foot/by chair, via mobile phone | Know in advance, or find out immediately while out, whether ramps/lifts/pavements on their route are usable | No way to know a route is blocked until arriving at the obstruction in person |

### User Personas

A wheelchair user in Belfast city centre who wants to plan a route before leaving home, and who — when they encounter a broken lift or blocked ramp while already out — wants to both find an alternative and warn others by logging it on the spot, from their phone, without needing to log in or fill in a lengthy form.

---

## 3. Scope

### 3.1 In Scope

- Live map of Belfast city centre showing current crowd-sourced accessibility reports.
- Reporting a new blocker: GPS-based pin placement (draggable to refine), category selection, optional photo, automatic timestamp.
- Four report categories, each with a distinct custom map icon: Lifts, Construction, Blocked Ramps, Blocked Pavement.
- Fully automatic real-time sync: a new report appears on all connected users' maps within seconds, with no manual refresh.
- Seed/demo data pre-loaded on the map so it is not empty at first load.
- Fallback to manual tap-to-place-pin if the user denies/lacks location permission.
- Mobile browser support, usable while walking around outdoors.
- One-shot turn-by-turn navigation to a tapped destination, routed to avoid currently reported blockers.

### 3.2 Out of Scope

- User accounts / login of any kind.
- Verification or moderation of crowd-sourced reports.
- Push notifications or alerts.
- Live GPS-tracked navigation with automatic re-routing while walking (navigation is a one-shot route calculated once at request time, not continuously updated).
- Report expiry / auto-fade of old reports (reports remain visible indefinitely for MVP; staleness/trust handling is backlog).
- Content moderation of photos or reports — accepted as an explicit MVP risk (see Section 7).
- WCAG accessibility certification (app aims to be "reasonably usable"; full WCAG compliance is backlog).

---

## 4. Features & Acceptance Criteria

### 4.1 View Live Accessibility Map

**Description:** Any user can open the app and see a map of Belfast city centre with pins showing currently reported accessibility blockers, each displayed with a distinct icon per category.

**Requirement ref:** FR-01

**Priority:** Must Have

**Acceptance Criteria:**

- [ ] On opening the app, the user sees a map centred on Belfast city centre with pre-loaded seed pins visible.
- [ ] Each pin is displayed using a custom icon that visually distinguishes its category (Lifts, Construction, Blocked Ramps, Blocked Pavement).
- [ ] Tapping/clicking a pin shows its category and timestamp, and photo if one was attached.

**Usability Criteria:**

- [ ] A first-time user can identify what a pin represents (category) without needing instructions, based on the icon alone.

---

### 4.2 Report a New Accessibility Blocker

**Description:** A user who encounters a broken lift, blocked ramp, blocked pavement, or construction obstruction can log it from their phone, and it becomes visible to all other users live.

**Requirement ref:** FR-02

**Priority:** Must Have

**Acceptance Criteria:**

- [ ] The user can start a new report from the map view.
- [ ] The app attempts to use device GPS to place the pin at the user's current location automatically.
- [ ] The user can drag the pin to refine its exact position before submitting.
- [ ] If location permission is denied or unavailable, the user can instead manually tap the map to place the pin.
- [ ] The user selects exactly one category: Lifts, Construction, Blocked Ramps, or Blocked Pavement.
- [ ] The user may optionally attach a photo; submission is not blocked if no photo is attached.
- [ ] On submission, the report is saved with an automatic timestamp and appears on the reporting user's own map immediately.
- [ ] No login or account is required to submit a report.

**Usability Criteria:**

- [ ] A user can complete a report (pin, category, submit) in under 30 seconds without needing instructions.

---

### 4.3 Real-Time Shared Updates (Core Demo Feature)

**Description:** Reports are shared live across all connected users. This is the feature that proves the app is a genuinely multiplayer, shared experience rather than a single-user tool with a map skin.

**Requirement ref:** FR-03

**Priority:** Must Have

**Acceptance Criteria:**

- [ ] When User A submits a new report, User B — on a separate, independently connected device/browser session — sees the new pin appear on their map automatically, without refreshing the page.
- [ ] The pin appears on User B's map within a few seconds of submission.
- [ ] This behaviour is verified with at least two simultaneously connected sessions before the live demo.

---

### 4.4 Navigate Around Reported Blockers

**Description:** A user can tap a destination on the map and get a route from their current (or tapped) location that avoids currently reported blockers, along with a list of turn-by-turn instructions.

**Requirement ref:** FR-04

**Priority:** Should Have

**Acceptance Criteria:**

- [ ] The user can start navigation from the map view.
- [ ] The app attempts to use device GPS for the starting point; if denied, the user taps the map to set a starting point, then taps again to set the destination.
- [ ] The destination is set by tapping the map (no search/address lookup).
- [ ] The calculated route avoids currently reported blockers where a viable path exists.
- [ ] A list of turn-by-turn instructions with distances is shown alongside the route line on the map.
- [ ] If no route can be found avoiding blockers, the app automatically retries without avoidance and clearly warns the user the route may cross a reported blocker.
- [ ] If no route can be found at all, the user sees a clear message and can tap a different destination without restarting the whole flow.
- [ ] The route is calculated once per request and does not automatically update as the user moves or as new reports come in (one-shot, not live-tracked) — this is documented, expected behaviour, not a bug.

**Usability Criteria:**

- [ ] A user can start navigation and get a route in two taps or fewer beyond the initial "Navigate" button press (assuming GPS is available).

---

## 5. Non-Functional Requirements

| ID | Category | Requirement | Acceptance criterion |
|---|---|---|---|
| NFR-01 | Performance | New reports propagate to other connected clients within a few seconds | Verified manually with two simultaneous browser sessions |
| NFR-02 | Scale | System supports fewer than 10 concurrent users (demo-day scale only, not production) | No load testing required; demo-day usage only |
| NFR-03 | Accessibility (app UI) | Reasonably usable interface (adequate tap target size, sensible contrast) for MVP; full WCAG 2.1 AA compliance is backlog | Manual review only for MVP |
| NFR-04 | Security / Trust | No authentication; reports and photos are unmoderated and anonymous — accepted risk for MVP | Documented as accepted risk, not tested |
| NFR-05 | Platform | Must run in a mobile browser and remain usable while the user is walking outdoors | Manually tested on at least one mobile device outdoors or in a walking simulation |

---

## 6. Constraints

- **Timeline:** 3 hours total for build, deployment, and demo.
- **Stack:** Leaflet (map rendering) + Supabase (Postgres + Realtime for live sync) + OpenRouteService Directions API (routing) + Vercel (deployment).
- **Team size/skill:** Small hackathon team; no time budgeted for custom backend infrastructure beyond Supabase's managed services.
- **No budget for paid map tile/geocoding services** — use free tiles (e.g., OpenStreetMap via Leaflet).

---

## 7. Data & Integrations

**Key data entities:**

- **Report**: location (latitude/longitude pin), category (enum: Lifts, Construction, Blocked Ramps, Blocked Pavement), photo (optional, stored as an uploaded file/URL), timestamp (auto-generated on submission).

**External integrations:**

- Supabase (Postgres database + Realtime subscriptions) as the backend.
- Leaflet + free OpenStreetMap tiles for map rendering.
- Browser Geolocation API for GPS-based pin placement.
- OpenRouteService Directions API (free tier) for blocker-avoiding pedestrian routing (FR-04).

**Data sensitivity:**

- No personal data or accounts are collected; reports are anonymous.
- Photos are unmoderated and could theoretically contain inappropriate content — accepted as a documented MVP risk given the absence of any moderation mechanism. No PII is knowingly collected.

---

## 8. UX Requirements Summary

- Users think in terms of "is my route blocked?" and "I just found something broken, I should log it" — the UI should support both journeys directly from the map view, not bury reporting behind menus.
- The four category icons are the primary way users will scan the map at a glance — icons must be visually distinct from each other at typical map zoom levels.
- The in-the-moment reporting journey happens outdoors, one-handed, potentially with limited dexterity — the reporting flow must be short (pin, category, optional photo, submit) and forgiving of GPS inaccuracy via the drag-to-refine step.
- Full WCAG accessibility compliance is out of scope for MVP but is a natural and expected next step given the target user group; this should be clearly flagged to future development as a priority, not an afterthought.

---

## 9. Sign-off

This document represents the agreed requirements for the project as captured in conversation
with the stakeholder. Before development begins, the stakeholder should review this document
and confirm it accurately reflects what was discussed.

| Role | Name | Status | Date |
|---|---|---|---|
| Stakeholder | (Hackathon team) | Pending | |
| BA / UX Researcher | Requirements Elicitation Skill | Prepared | 2026-09-03 |

---

_This document is the reference for all development, testing, and assurance activity on this
project. Any changes to requirements after sign-off must be captured in an updated version of
this document before implementation begins._
