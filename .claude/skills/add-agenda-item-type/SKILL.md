---
name: add-agenda-item-type
description: Checklist for adding a new agenda item type (beyond row/dual/speakers/evaluators/recess/notes) to the agenda editor. Use whenever asked to add a new kind of agenda entry, so no touch point gets missed.
---

Adding a new `AgendaItem` variant touches several files that must all
agree on the new type's shape. Missing one leaves the feature half-built
— it might compile but silently fail to render, export, or time itself
correctly. Work through this list in order.

## 1. Model — `src/app/features/agenda-editor/models/agenda.models.ts`

Add the new interface to the discriminated union:
```typescript
export interface AgendaMyNewItem {
  id: number;
  type: 'myNewType';
  // whatever fields this type needs
}
```
Add it to the `AgendaItem` union type at the bottom of the file.

## 2. State — `src/app/features/agenda-editor/services/agenda-state.service.ts`

`addAgItem(type)`'s `switch` needs a new `case` constructing a sensible
default instance of the new type.

If the new type should appear in the standard meeting template, also add
it to `src/app/features/agenda-editor/services/default-agenda.ts`'s `defaultAgenda()` array
(each entry there calls `nextId()` for its `id`).

## 3. Editing UI — `src/app/features/agenda-editor/components/agenda-items/`

`agenda-items.component.html`'s `@switch (item.type)` needs a new
`@case ('myNewType')` block rendering the editing form for this item
(inputs bound to `update(item.id, field, value)`, following the existing
cases' pattern). If the new type needs a distinct badge/color, add it to
`agenda-items.component.ts`'s `typeBadge`/`typeClass`/`badgeClass` lookup
maps.

## 4. Timeline — `src/app/features/agenda-editor/utils/agenda-timeline.ts`

If this item type should advance the meeting clock (most do — check
whether it has a duration or otherwise takes up time), add a `case` to
`computeAgendaTimeline()`'s switch. If it has no duration (like
`speakers`/`notes`), it still needs a case that pushes a `TimelineEntry`
with the appropriate `kind` and no time advance — every item must produce
exactly one timeline entry, in order, or downstream consumers that zip
`agItems` with the timeline array by index will misalign.

Cover the new case in `src/app/features/agenda-editor/utils/agenda-timeline.spec.ts` — this file
is written test-first for exactly this reason (see `CLAUDE.md`).

## 5. Live preview — `src/app/features/agenda-editor/components/agenda-preview/agenda-preview.component.ts`

The `switch (item.type)` in `renderedAgenda` needs a new case mapping the
item (plus its `computeAgendaTimeline` entry) to a `RenderedRow`/`Segment`
the template can render. Add matching markup to
`agenda-preview.component.html`.

## 6. DOCX export — `src/app/features/agenda-editor/services/docx.service.ts`

`buildAgendaBody()`'s `items.forEach` switch needs a case building the
DOCX table row(s) for this item type, using the corresponding
`timeline[i]` entry for its time(s). **Any new width constants must sum
to `CONTENT_W` (10546 twips) or the parent width they nest under** — see
`assertWidths()` and the `docx-layout-guardian` agent if one exists in
this project. Do not skip this step even for a simple item type — a row
that isn't handled here silently disappears from the exported document
while still showing in the preview, which is a confusing bug to track
down later.

## Verification

After all six steps: `ng build` (catches missing switch cases via
exhaustiveness where TypeScript can infer it, though not all of these
switches are strictly exhaustive-checked — read them manually too),
`ng test` (the timeline spec should cover the new case), then a manual
browser check: add the new item type via the UI, confirm it shows
correctly in both the live preview and a generated DOCX, and that the
DOCX's times match the preview's times exactly.
