---
name: role-locking-pattern
description: The read-decide-update pattern for any first-come-first-served claimable resource in the check-in feature (roles, evaluator slots, and any future claimable thing). Use when adding a new kind of claim/release action to CheckinStateService or a similar service.
---

The check-in page's core value is atomic, first-come-first-served claims:
once someone claims a role or an evaluator slot, no one else can take it
until they release it. Two existing methods on
`src/app/features/checkin/services/checkin-state.service.ts` implement this correctly —
`claimRole()` and `claimEvaluatorSlot()`. Any new claimable resource
should follow the same shape.

## The pattern

```typescript
claimSomething(resourceId: string): boolean {
  if (!this.currentName()) return false;           // must be checked in

  const current = this.snapshot().<resourceMap>[resourceId];
  if (<already claimed by someone else>) return false;
  if (<any other business-rule rejection>) return false;

  this.update((s) => ({
    ...s,
    <resourceMap>: { ...s.<resourceMap>, [resourceId]: { name: this.currentName(), uid: this.currentUid } },
  }));
  return true;
}
```

**Read first, decide, then update conditionally.** Do not call
`this.update()` and mutate an outer variable from inside its callback to
report success/failure back to the caller — that pattern used to exist in
this file (in an earlier version of `claimRole`/`claimEvaluatorSlot`) and
was deliberately rewritten away from because it's harder to read top to
bottom. The current shape — snapshot, check, then a single conditional
`update()` call — is the one to copy.

**Release is symmetric and self-limited:**
```typescript
releaseSomething(resourceId: string): void {
  this.update((s) => {
    const current = s.<resourceMap>[resourceId];
    if (!current || current.uid !== this.currentUid) return s;  // not yours, no-op
    return { ...s, <resourceMap>: { ...s.<resourceMap>, [resourceId]: <cleared> } };
  });
}
```
A member may only release their *own* claim — never someone else's, and
never silently no-op in a way that looks like it worked (return the
unchanged state so nothing gets persisted).

## Things this pattern deliberately handles

- **Not checked in yet** → reject before touching state (`if
  (!this.currentName()) return false;`).
- **Already claimed by someone else** → reject, don't overwrite.
- **Re-claiming your own already-held claim** → this is allowed to
  succeed as a no-op in `claimRole` (claiming a role you already claim
  just re-confirms it) — decide deliberately whether your new resource
  should behave the same way or should reject re-claims too.
- **Self-referential rejection** — `claimEvaluatorSlot` additionally
  checks `target.uid === this.currentUid` to block evaluating your own
  speech, and separately checks the claimant isn't already evaluating
  someone else (`s0.speakers.some(sp => sp.evaluator?.uid ===
  this.currentUid)`). If your new resource has a similar "can't do X to
  your own Y" or "can only hold one Z at a time" rule, encode it as an
  explicit early-return check, not buried inside the update callback.

## Testing

Every claim/release pair needs spec coverage for: success when open,
rejection when already claimed by another uid, rejection when not
checked in, and — if applicable — the self-referential and
one-at-a-time rules. See
`src/app/features/checkin/services/checkin-state.service.spec.ts` for the existing
`claimRole`/`releaseRole`/`claimEvaluatorSlot` cases as the template to
follow, including the `FakeStorage` TestBed setup.
