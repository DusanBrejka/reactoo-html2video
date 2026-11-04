---
title: Manchester City Broadcast Overlays - Plan
type: feat
date: 2026-11-04
topic: mancity-broadcast-overlays
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Manchester City Broadcast Overlays - Plan

## Goal Capsule

- **Objective:** An operator can render seven match overlays that follow the Liverpool 0-3 Manchester City highlights package, change the words, logo images, and colours, and lay the result over picture because the frame outside each graphic is transparent.
- **Authority:** The full set wins on scope. The downloaded highlights win on what each graphic shows. The moving overlays already in the repo win on holding, then clearing. The Match Day and Full Time stills stay as they are.
- **Execution:** Code. Prove each overlay with a local render whose last frame is transparent, then one remote render each on the existing render.
- **Stop:** Stop the publish step if the remote render cannot authenticate, and record the error.
- **Open blockers:** None.
- **Finishes:** The seven overlays, the local renders, and one remote render each. Merging stays with the operator.

---

## Product Contract

### Summary

Ship seven transparent 1920×1080 overlays in `source/mancity`: match bar, lineup, kick-off stinger, score, minute, second-half stinger, and yellow card. Each one can change its words, logo images, and colours, holds, then clears.

### Problem Frame

`source/mancity` has full-frame Match Day and Full Time stills. It does not have the lower-thirds, lineup, stingers, score, minute, or card from the highlights. Those graphics have to sit on match picture, so a coloured page behind them cannot ship.

### Key Decisions

- **Ship all seven.** (session-settled: user-directed — chosen over dropping any of them: the full set is the smallest useful version.) Governs R1.
- **The card includes the yellow bar.** (session-settled: user-directed — chosen over a name bar alone: the bar under the name reads YELLOW CARD.) Governs R8.

### Requirements

**The seven graphics**

- R1. Ship seven overlays in `source/mancity`, at 1920×1080, and leave `MC_GameDay.html` and `MC_FullTime.html` unchanged.
- R2. The match bar shows a home name and crest, a league mark, an away name and crest, then a stadium tab and a date line. Unedited, those read Liverpool, Man City, ANFIELD, and SUN 11/10/26 - 16:30 (UK). The home side is red, the away side is sky blue, and the type is white.
- R3. The lineup is one navy panel with three crests, eleven numbered names, a captain mark on one name, and a substitutes line. Unedited, the names are the City eleven from the highlights, with the captain mark on DIAS.
- R4. The kick-off stinger fills the frame with navy, two crests, and the words KICK OFF, then clears.
- R5. The score sits at the top left: home crest, home score, league mark, away score, away crest. Unedited, the score is 0 and 0.
- R6. The minute sits at the bottom left in a navy pill. Unedited, it reads 19'.
- R7. The second-half stinger fills the frame with navy, small crests, and the words 2ND HALF, then clears.
- R8. The card sits at the bottom right: a number, a crest, a player name, and a yellow bar under the name. Unedited, it reads 47, Ryan Gravenberch, and YELLOW CARD.

**Edit and playback**

- R9. A render can replace any word in R2–R8, any logo image, and any of that overlay's colours, without moving the layout. An empty stadium, date, or card label leaves that piece out.
- R10. The minute and the scores are the edited text. They do not count or change on their own during the render.
- R11. Each overlay enters, holds for its `animation.hold` seconds, then leaves. The page outside the graphic is transparent, and the last frame has no opaque pixels.
- R12. After a local render of each overlay ends on a transparent frame, each one can be rendered through the existing remote render.

### Actors

- A1. The operator, who sets the words, logos, and colours and renders an overlay.

### Key Flows

- F1. Render one overlay
  - **Trigger:** The operator renders one of the seven with or without a text, logo, or colour change.
  - **Actors:** A1
  - **Steps:** The graphic plays in, holds the settled design, then leaves.
  - **Outcome:** A transparent video whose held frame matches that overlay's unedited copy unless the operator replaced it.
  - **Covered by:** R9, R11, R12

### Acceptance Examples

- AE1. Unedited match bar
  - **Covers R2, R11.**
  - **Given** the match bar with no edits
  - **When** a frame is taken during the hold
  - **Then** it shows Liverpool, Man City, ANFIELD, and SUN 11/10/26 - 16:30 (UK), and the corner of the frame is transparent
- AE2. Unedited card
  - **Covers R8, R11.**
  - **Given** the card with no edits
  - **When** a frame is taken during the hold and another after the exit
  - **Then** the hold shows 47, Ryan Gravenberch, and YELLOW CARD, and the last frame has no opaque pixels
- AE3. Edited minute
  - **Covers R6, R9, R10.**
  - **Given** the minute text is 67'
  - **When** the overlay is rendered
  - **Then** the pill reads 67' for the whole hold

### Scope Boundaries

- The Match Day and Full Time stills are not redesigned.
- The pitch, crowd, and broadcast picture are not part of any overlay.
- A live clock that ticks through the clip is out.
- Official competition and club artwork is not drawn into the overlays. Logo slots use the monogram badges already used by the Manchester City stills, and the operator replaces the image to change a crest.

### Dependencies / Assumptions

- The highlights file used to read the seven graphics is a local reference only and is not part of the repo.
- Default crests are the existing stand-in badges plus a red home monogram and a plain league mark. Swapping the image files is how a real crest is used.
- Publish uses the existing remote render. A new renderer is not required.

### Outstanding Questions

None.
