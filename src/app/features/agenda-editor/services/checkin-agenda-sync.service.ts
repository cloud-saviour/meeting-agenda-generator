import { Injectable } from '@angular/core';
import { AgendaStateService } from './agenda-state.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';

/**
 * Merges a meeting's live check-in state (role claims, speaker signups and
 * their evaluator slots, apologies) onto an AgendaStateService's in-memory
 * agenda.
 *
 * Shared by AgendaEditorComponent (merging into a live draft being edited)
 * and AgendaViewerComponent (merging onto the loaded published snapshot, so
 * /preview reflects check-in activity live instead of only whatever was
 * frozen at publish time). Both need identical merge behaviour — only the
 * way their agenda state got hydrated differs — so this logic lives here
 * rather than being duplicated per page.
 *
 * Nothing here writes to Firestore: it only updates AgendaStateService's
 * signals. On /admin an admin's explicit Save is still what persists the
 * result; on /preview the merge is purely what gets rendered.
 */
@Injectable({ providedIn: 'root' })
export class CheckinAgendaSyncService {
  // Per meeting number, then per roleId: the last name this sync itself put
  // into the agenda for that role. Lets a release be told apart from "never
  // claimed" (both look like an empty claim otherwise), and lets a release
  // clear the agenda ONLY while it still shows exactly what the sync put
  // there, never a name the admin has since typed in by hand.
  //
  // Keyed by meeting number because this service is a root singleton shared
  // by the editor and the viewer: a flat map would let one meeting's claims
  // decide whether to clear a same-named role in a different meeting opened
  // later in the same tab.
  private readonly lastSyncedPersonByRole = new Map<string, Map<string, string>>();

  /**
   * Applies whatever `checkin` currently holds onto `state`. Assumes
   * `checkin.loadMeeting()` already ran for this meeting — and verifies it,
   * since loadMeeting() keeps serving the previous meeting's snapshot until
   * the new listener's first callback arrives, and merging that into a
   * freshly opened agenda would attribute the wrong meeting's roles.
   */
  apply(meetingNo: string, state: AgendaStateService, checkin: CheckinStateService): void {
    if (!meetingNo || checkin.meeting().id !== meetingNo) return;

    this.applyRoles(meetingNo, state, checkin);
    this.applySpeakers(state, checkin);
    this.applyApologies(state, checkin);
  }

  private applyRoles(meetingNo: string, state: AgendaStateService, checkin: CheckinStateService): void {
    let lastSynced = this.lastSyncedPersonByRole.get(meetingNo);
    if (!lastSynced) {
      lastSynced = new Map<string, string>();
      this.lastSyncedPersonByRole.set(meetingNo, lastSynced);
    }

    const overridden = state.overriddenRoles();
    for (const [roleId, claim] of Object.entries(checkin.roles())) {
      if (overridden.has(roleId)) continue;
      const name = claim?.name ?? '';
      if (name) {
        state.applyRolePerson(roleId, name);
        lastSynced.set(roleId, name);
        continue;
      }
      const previous = lastSynced.get(roleId);
      if (previous !== undefined) {
        if (state.getRolePerson(roleId) === previous) {
          state.applyRolePerson(roleId, '');
        }
        lastSynced.delete(roleId);
      }
      // else: never synced and still empty — leave whatever's there alone.
    }
  }

  /**
   * Keyed by name, not just a Set of names — an already-imported speaker
   * still needs their evaluator field kept in sync (an evaluator claims a
   * slot on an existing signup, so that claim almost always lands AFTER the
   * speaker was imported). A Set could only ever tell "already imported"
   * from "new", silently dropping every later evaluator change.
   */
  private applySpeakers(state: AgendaStateService, checkin: CheckinStateService): void {
    const spksByName = new Map(state.spks().map((s) => [s.name.trim().toLowerCase(), s]));
    for (const sp of checkin.speakers()) {
      const key = sp.name.trim().toLowerCase();
      if (!key) continue;
      const checkinEvaluator = sp.evaluator?.name ?? '';

      const existing = spksByName.get(key);
      if (existing) {
        if (existing.evaluator !== checkinEvaluator) {
          state.updateSpeaker(existing.id, 'evaluator', checkinEvaluator);
        }
        continue;
      }

      const { timeLo, timeHi } = this.parseTimePref(sp.timePref);
      state.addSpeaker({
        name: sp.name,
        title: sp.title,
        level: sp.level,
        evaluator: checkinEvaluator,
        timeLo,
        timeHi,
      });
    }
  }

  /**
   * Imports check-in apology names (from uncheckIn()) into the agenda's own
   * free-text apologies field, and retracts one again once its uid drops out
   * of check-in's list (they clicked "I'm Attending" again) — only while the
   * text still holds exactly the token this sync added, never touching
   * anything typed or edited by hand.
   *
   * Which names were sync-added is tracked in `MeetingData.apologySyncUids`,
   * part of the saved agenda itself rather than this service's memory,
   * specifically so a retraction still works across a page reload between
   * "they apologized" and "they re-attended".
   *
   * This is a heuristic over free text, not a structured list: prose like
   * "Bob and Carol" (no comma) won't register "Carol" as already present, so
   * a later apology from Carol could append a redundant second "Carol" — an
   * accepted cost of apologies staying a free-text field.
   */
  private applyApologies(state: AgendaStateService, checkin: CheckinStateService): void {
    let apologiesText = state.meeting().apologies;
    const syncedUids: Record<string, string> = { ...(state.meeting().apologySyncUids ?? {}) };
    const checkinApologies = checkin.apologies();
    const currentApologyUids = new Set(checkinApologies.map((a) => a.uid));

    const existingApologyNames = new Set(
      apologiesText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
    for (const a of checkinApologies) {
      const name = a.name.trim();
      if (!name) continue;

      // Import each person at most ONCE. After that the text is the admin's
      // to edit — including deleting a name, or clearing the whole field.
      // Without this, clearing Apologies silently undid itself: the next sync
      // saw the name missing and re-appended it, and since the sync re-runs on
      // every check-in change, that happened almost immediately.
      if (a.uid in syncedUids) continue;

      if (!existingApologyNames.has(name.toLowerCase())) {
        apologiesText = [apologiesText, name].filter(Boolean).join(', ');
        existingApologyNames.add(name.toLowerCase());
      }
      syncedUids[a.uid] = name;
    }

    for (const [uid, syncedName] of Object.entries(syncedUids)) {
      if (currentApologyUids.has(uid)) continue;
      const tokens = apologiesText.split(',').map((s) => s.trim());
      const idx = tokens.findIndex((t) => t.toLowerCase() === syncedName.toLowerCase());
      if (idx !== -1) {
        tokens.splice(idx, 1);
        apologiesText = tokens.filter(Boolean).join(', ');
      }
      delete syncedUids[uid];
    }

    if (
      apologiesText !== state.meeting().apologies ||
      JSON.stringify(syncedUids) !== JSON.stringify(state.meeting().apologySyncUids ?? {})
    ) {
      state.updateMeeting({ apologies: apologiesText, apologySyncUids: syncedUids });
    }
  }

  private parseTimePref(pref: string): Partial<{ timeLo: number; timeHi: number }> {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(pref?.trim() ?? '');
    return m ? { timeLo: Number(m[1]), timeHi: Number(m[2]) } : {};
  }
}
