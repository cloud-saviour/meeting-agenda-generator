import { Component, OnDestroy, computed, effect, inject, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AgendaStateService } from '../services/agenda-state.service';
import { AgendaImportExportService } from '../services/agenda-import-export.service';
import { PublishedAgendaService } from '../services/published-agenda.service';
import { SavedAgendaService } from '../services/saved-agenda.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';
import { CheckinAgendaSyncService } from '../services/checkin-agenda-sync.service';
import { DocxService } from '../services/docx.service';
import { MeetingFormComponent } from '../components/meeting-form/meeting-form.component';
import { AgendaItemsComponent } from '../components/agenda-items/agenda-items.component';
import { SpeakersFormComponent } from '../components/speakers-form/speakers-form.component';
import { AgendaPreviewComponent } from '../components/agenda-preview/agenda-preview.component';
import { NavbarComponent, NavLink } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-agenda-editor',
  standalone: true,
  imports: [
    RouterLink,
    NavbarComponent,
    MeetingFormComponent,
    AgendaItemsComponent,
    SpeakersFormComponent,
    AgendaPreviewComponent,
  ],
  templateUrl: './agenda-editor.component.html',
})
export class AgendaEditorComponent implements OnDestroy {
  readonly state = inject(AgendaStateService);
  private readonly docxService = inject(DocxService);
  private readonly importExport = inject(AgendaImportExportService);
  private readonly publishedAgenda = inject(PublishedAgendaService);
  private readonly savedAgendas = inject(SavedAgendaService);
  private readonly checkinState = inject(CheckinStateService);
  private readonly checkinSync = inject(CheckinAgendaSyncService);
  private readonly router = inject(Router);

  docxBusy = false;
  linkCopied = false;
  mobilePreviewMode = false;

  // Drives the navbar Save button — true whenever the in-memory agenda
  // differs from what's actually persisted in savedAgendas. Saving is now
  // an explicit action (see save() below), not automatic, so this is what
  // tells the admin (and newAgenda()/beforeunload below) there's something
  // that would be lost if they navigate away or close the tab without
  // clicking Save.
  isDirty = false;
  saving = false;
  justSaved = false;

  // The last snapshot JSON actually written via save() below (or, at
  // construction, whatever was already loaded — see the constructor) —
  // isDirty is just "does the current snapshot still match this." Unlike
  // the old auto-save's lastSavedJsonByNo, this doesn't need to be keyed
  // per meeting number: newAgenda()/opening a different draft each replace
  // this component's whole in-memory state, and isDirty's own `!!no` guard
  // (see the dirty-tracking effect below) already treats a blank meeting
  // number as "not dirty" regardless of what this holds.
  private lastSavedJson: string;

  // Same idea, for the meeting-fields push effect below — lets it skip a
  // no-op checkinState.updateMeeting() call, keyed per meeting number.
  private readonly lastPushedMeetingJsonByNo = new Map<string, string>();

  // Debounce timer for the meeting-fields push effect below — Firestore writes
  // are no longer free the way an in-memory/localStorage write was.
  private meetingSyncTimer: ReturnType<typeof setTimeout> | undefined;

  // Warns on an actual tab close/refresh/external navigation with unsaved
  // changes — in-app route changes (My Agendas, Home, etc.) go through
  // Angular's router instead, which this listener can't intercept; see
  // newAgenda()'s own confirm() for the one in-app action that would
  // otherwise silently discard unsaved work.
  private readonly beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (!this.isDirty) return;
    e.preventDefault();
  };

  constructor() {
    // Seeds the dirty baseline to whatever's already loaded at construction
    // — a fresh blank agenda (resetAll() already ran before this component
    // exists) or a draft AdminAgendasComponent.open() loaded via
    // loadSnapshot() before navigating here. Either way, "what's on screen
    // right now" is the correct starting point for "has it changed since
    // the last save," not an empty string (which would show every freshly
    // opened, unmodified agenda as dirty).
    this.lastSavedJson = JSON.stringify(this.importExport.getSnapshot());
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    // A dedicated computed so the effect only re-runs when the meeting NUMBER
    // string actually changes — `state.meeting()` is one combined signal for
    // the whole meeting-details form, so depending on it directly would
    // re-trigger this on every keystroke in an unrelated field (theme, date,
    // etc.), not just when `no` changes.
    const meetingNo = computed(() => this.state.meeting().no);

    effect(() => {
      // Only `meetingNo()` should drive this effect — loadMeeting() just
      // subscribes; applying the data itself happens in the reactive re-sync
      // effect below, so it also fires on live updates, not just the initial load.
      const no = meetingNo();
      untracked(() => {
        if (!no) return;
        this.checkinState.loadMeeting(no);
      });
    });

    // Live check-in sync: re-applies check-in roles/speakers every time
    // checkinState's own signals change — which happens on the initial load
    // AND every time Firestore's live listener delivers a claim/signup made
    // from ANY device, not just another tab of this browser. Replaces the old
    // localStorage `storage`-event listener outright; this is strictly better
    // since it's real cross-device sync (see CLAUDE.md's Persistence section).
    effect(() => {
      // Only these three should drive this effect — everything
      // `CheckinAgendaSyncService.apply()` reads/writes (spks,
      // overriddenRoles, AgendaStateService's signals) must stay untracked,
      // or the effect would re-trigger itself on every edit it makes,
      // including ordinary manual admin edits.
      this.checkinState.roles();
      this.checkinState.speakers();
      this.checkinState.apologies();
      untracked(() => {
        this.checkinSync.apply(this.state.meeting().no, this.state, this.checkinState);
      });
    });

    // Push meeting details (theme/date/word/start/club/sub/addr) into
    // check-in's own CheckinMeeting record, so the header members see at
    // /checkin reflects the real agenda instead of check-in's own separate,
    // otherwise-never-set defaults. One-way (agenda is the source of truth)
    // — nothing reads these fields back from check-in. Tracks the whole
    // `meeting()` signal for the same reason as the auto-save effect below:
    // simplicity over narrowly scoping seven fields. Debounced, unlike
    // before: this is now a real Firestore write per call, not a free
    // in-memory one, so it shouldn't fire on every keystroke.
    //
    // Skips the write when none of the 7 pushed fields actually changed
    // since the last push for this meeting number — same pattern as the
    // auto-save effect's lastSavedJsonByNo below. Without this, ANY change
    // to `meeting()` (e.g. apologySyncUids being updated by the check-in
    // sync effect below, which is part of this same signal) re-triggers a
    // real checkinState.updateMeeting() write even when none of these 7
    // fields moved — and that write's own runTransaction() round-trip
    // re-fires checkins' onSnapshot listener, which re-runs the check-in
    // sync effect, which can touch `meeting()` again, sustaining a
    // feedback loop through repeated real Firestore round-trips (caught by
    // an auditLog entry storm: ~100 redundant agenda.publish entries for
    // one meeting in under an hour, all with identical content).
    effect(() => {
      const m = this.state.meeting();
      if (!m.no) return;
      clearTimeout(this.meetingSyncTimer);
      this.meetingSyncTimer = setTimeout(() => {
        const pushed = { date: m.date, theme: m.theme, word: m.word, start: m.st, club: m.club, sub: m.sub, addr: m.addr };
        const json = JSON.stringify(pushed);
        if (this.lastPushedMeetingJsonByNo.get(m.no) === json) return;
        this.lastPushedMeetingJsonByNo.set(m.no, json);
        this.checkinState.loadMeeting(m.no);
        this.checkinState.updateMeeting(pushed);
      }, 500);
    });

    // Dirty-tracking: the mirror image of the check-in-sync effect above —
    // this one SHOULD react to every edit, so no untracked() wrapping.
    // getSnapshot() reads every relevant signal (meeting, agItems, spks,
    // cmt, logos, overriddenRoles), so this naturally re-evaluates on any
    // change anywhere in the agenda. No debounce and no Firestore write
    // here at all — saving is now an explicit action (see save() below);
    // this effect only maintains the in-memory isDirty flag the Save
    // button and newAgenda()'s confirm() read, which is cheap enough to
    // recompute on every keystroke.
    effect(() => {
      const snapshot = this.importExport.getSnapshot();
      const json = JSON.stringify(snapshot);
      untracked(() => {
        this.isDirty = !!snapshot.no && json !== this.lastSavedJson;
      });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
  }

  /**
   * Explicit save — replaces the old debounced auto-save. Persists the
   * current in-memory agenda to savedAgendas, and, if this meeting is
   * already the published one, republishes it too in the same action
   * (otherwise clicking Save on a live meeting would leave the published
   * copy silently stale until a separate trip to My Agendas — see
   * isLivePublished/the "● Live" badge in the template).
   */
  async save(): Promise<void> {
    const snapshot = this.importExport.getSnapshot();
    if (!snapshot.no || this.saving) return;
    this.saving = true;
    try {
      await this.savedAgendas.save(snapshot);
      if (this.publishedAgenda.entries().some((e) => e.no === snapshot.no)) {
        await this.publishedAgenda.publish(snapshot.no, snapshot);
      }
      this.lastSavedJson = JSON.stringify(snapshot);
      this.isDirty = false;
      this.justSaved = true;
      setTimeout(() => (this.justSaved = false), 2000);
    } catch (err) {
      alert('Save failed:\n' + (err as Error).message);
      console.error(err);
    } finally {
      this.saving = false;
    }
  }

  /**
   * Saving is no longer automatic (see save() above), so — unlike before,
   * when the previous agenda was always already auto-saved under its own
   * meeting number — resetAll() here really would silently discard
   * whatever hasn't been saved yet. Confirm first if isDirty.
   */
  newAgenda() {
    if (this.isDirty && !confirm('Discard unsaved changes to the current agenda and start a new one?')) return;
    this.state.resetAll();
    this.isDirty = false;
  }

  /** True once this open meeting is the currently-published one — drives the passive "● Live" badge that replaced the old Publish button. */
  get isLivePublished(): boolean {
    return this.publishedAgenda.entries().some((e) => e.no === this.state.meeting().no);
  }

  /**
   * "Meeting Check-in" only appears once this meeting is actually live
   * (published) — before that, there's nothing for a member to check into
   * yet, so pointing anyone at /checkin from here would be premature.
   */
  get navLinks(): NavLink[] {
    const links: NavLink[] = [];
    if (this.isLivePublished) {
      links.push({ label: '👥 Meeting Check-in', path: '/checkin', queryParams: { meeting: this.state.meeting().no } });
    }
    links.push({ label: '🏠 Home', path: '/' });
    return links;
  }

  toggleMobilePreview() {
    this.mobilePreviewMode = !this.mobilePreviewMode;
  }

  onRoleOverrideChanged({ roleId, overridden }: { roleId: string; overridden: boolean }) {
    const meetingNo = this.state.meeting().no;
    if (!meetingNo) return;
    this.checkinState.loadMeeting(meetingNo);
    this.checkinState.setRoleLocked(roleId, overridden);
  }

  async copyCheckinLink() {
    const meetingNo = this.state.meeting().no;
    if (!meetingNo) return;
    const tree = this.router.createUrlTree(['/checkin'], { queryParams: { meeting: meetingNo } });
    const url = window.location.origin + this.router.serializeUrl(tree);
    if (await this.copyToClipboard(url)) {
      this.linkCopied = true;
      setTimeout(() => (this.linkCopied = false), 2000);
    } else {
      alert('Could not copy automatically — here is the check-in link:\n' + url);
    }
  }

  /**
   * navigator.clipboard requires a secure context (HTTPS or localhost) — the
   * LAN dev server (`npm run serve:mobile`) is plain HTTP, since the Firebase
   * emulators themselves are HTTP-only and an HTTPS page calling them is
   * mixed content that mobile Safari blocks outright (see CLAUDE.md's LAN-
   * access section) — so that API is unavailable when reached from a phone.
   * Falls back to the legacy execCommand('copy') path, which works in an
   * insecure context because it's a synchronous, user-gesture-triggered DOM
   * operation rather than an async permission-gated one. Returns false
   * (never throws) if both paths fail, so the caller can show the
   * manual-copy alert as a last resort.
   */
  private async copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.error(err);
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch (err) {
      console.error(err);
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async generateDocx() {
    this.docxBusy = true;
    try {
      const snapshot = this.importExport.getSnapshot();
      await this.docxService.generate(snapshot, this.state.agendaFileName());
    } catch (err) {
      alert('DOCX generation failed:\n' + (err as Error).message);
      console.error(err);
    } finally {
      this.docxBusy = false;
    }
  }

  saveJSON() {
    this.importExport.saveJSON(this.state.agendaFileName());
  }

  loadJSON() {
    document.getElementById('jf')?.click();
  }

  onImportJSON(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target!.result as string);
        this.importExport.loadSnapshot(data);
      } catch (err) {
        alert('Error loading JSON: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  printAgenda() {
    document.title = this.state.agendaFileName();
    window.print();
  }
}
