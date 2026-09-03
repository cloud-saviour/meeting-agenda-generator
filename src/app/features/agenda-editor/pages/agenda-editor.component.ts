import { Component, OnDestroy, computed, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AgendaStateService } from '../services/agenda-state.service';
import { AgendaImportExportService } from '../services/agenda-import-export.service';
import { PublishedAgendaService } from '../services/published-agenda.service';
import { SavedAgendaService } from '../services/saved-agenda.service';
import { CheckinStateService, checkinStorageKey } from '../../checkin/services/checkin-state.service';
import { DocxService } from '../services/docx.service';
import { MeetingFormComponent } from '../components/meeting-form/meeting-form.component';
import { AgendaItemsComponent } from '../components/agenda-items/agenda-items.component';
import { SpeakersFormComponent } from '../components/speakers-form/speakers-form.component';
import { CommitteeFormComponent } from '../components/committee-form/committee-form.component';
import { AgendaPreviewComponent } from '../components/agenda-preview/agenda-preview.component';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-agenda-editor',
  standalone: true,
  imports: [
    NavbarComponent,
    MeetingFormComponent,
    AgendaItemsComponent,
    SpeakersFormComponent,
    CommitteeFormComponent,
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
  private readonly router = inject(Router);

  docxBusy = false;
  linkCopied = false;
  published = false;
  mobilePreviewMode = false;

  // Live check-in sync: re-applies check-in roles/speakers whenever the meeting
  // number changes (including on first load) and whenever check-in data for
  // that meeting changes in ANOTHER tab of this browser (localStorage's
  // `storage` event never fires in the tab that made the write, only in other
  // tabs sharing the origin — there's no cross-device push without the planned
  // Firestore backend, see CLAUDE.md's Persistence section).
  private readonly onCheckinStorageChange = (event: StorageEvent) => {
    const meetingNo = this.state.meeting().no;
    if (!meetingNo || event.key !== checkinStorageKey(meetingNo)) return;
    this.checkinState.loadMeeting(meetingNo);
    this.applyCheckinSnapshot();
  };

  // Tracks, per roleId, the last name this component itself synced in from a
  // check-in claim — lets a release be told apart from "never claimed" (both
  // look like an empty claim otherwise), and lets a release clear the agenda
  // ONLY when it still shows exactly what check-in put there, never a name
  // the admin has since typed in by hand.
  private readonly lastSyncedPersonByRole = new Map<string, string>();

  // Last serialized snapshot JSON actually written per meeting number — lets
  // the auto-save effect below skip a no-op re-save (see its comment).
  private readonly lastSavedJsonByNo = new Map<string, string>();

  constructor() {
    // A dedicated computed so the effect only re-runs when the meeting NUMBER
    // string actually changes — `state.meeting()` is one combined signal for
    // the whole meeting-details form, so depending on it directly would
    // re-trigger this on every keystroke in an unrelated field (theme, date,
    // etc.), not just when `no` changes.
    const meetingNo = computed(() => this.state.meeting().no);

    effect(() => {
      // Only `meetingNo()` should drive this effect — everything
      // `applyCheckinSnapshot()` reads/writes (spks, overriddenRoles,
      // checkinState's signals) must stay untracked, or the effect would
      // re-trigger itself every time it (or anything else) edits agenda
      // speakers/roles, including ordinary manual admin edits.
      const no = meetingNo();
      untracked(() => {
        if (!no) return;
        this.checkinState.loadMeeting(no);
        this.applyCheckinSnapshot();
      });
    });
    window.addEventListener('storage', this.onCheckinStorageChange);

    // Push meeting details (theme/date/word/start) into check-in's own
    // CheckinMeeting record, so the header members see at /checkin reflects
    // the real agenda instead of check-in's own separate, otherwise-never-set
    // defaults. One-way (agenda is the source of truth) — nothing reads these
    // fields back from check-in. Tracks the whole `meeting()` signal, same as
    // the auto-save effect below, for the same reason: simplicity over
    // narrowly scoping four fields, since loadMeeting()+updateMeeting() is
    // cheap enough that re-running on an unrelated field edit is harmless.
    effect(() => {
      const m = this.state.meeting();
      if (!m.no) return;
      this.checkinState.loadMeeting(m.no);
      this.checkinState.updateMeeting({ date: m.date, theme: m.theme, word: m.word, start: m.st });
    });

    // Auto-save: the mirror image of the check-in-sync effect above — this one
    // SHOULD react to every edit, so no untracked() wrapping. getSnapshot()
    // reads every relevant signal (meeting, agItems, spks, cmt, logos,
    // overriddenRoles), so this naturally re-saves on any change anywhere in
    // the agenda. SavedAgendaService never touches AgendaStateService's own
    // signals, so there's no self-trigger risk.
    //
    // Skips the write entirely when the serialized snapshot is byte-identical
    // to what was last saved for that meeting number — otherwise merely
    // opening an already-saved agenda (loadSnapshot sets every signal, this
    // effect's first run would re-save the same content) bumps `updatedAt`
    // and reorders the "last edited" list even though nothing changed. Keyed
    // per meeting number, not globally, so switching between agendas doesn't
    // false-positive against a different agenda's last-saved content.
    effect(() => {
      const snapshot = this.importExport.getSnapshot();
      if (!snapshot.no) return;
      const json = JSON.stringify(snapshot);
      if (this.lastSavedJsonByNo.get(snapshot.no) === json) return;
      this.lastSavedJsonByNo.set(snapshot.no, json);
      this.savedAgendas.save(snapshot);
    });
  }

  ngOnDestroy() {
    window.removeEventListener('storage', this.onCheckinStorageChange);
  }

  /** Nothing to confirm — the previous agenda (if any) is already auto-saved under its own meeting number. */
  newAgenda() {
    this.state.resetAll();
  }

  publishAgenda() {
    const meetingNo = this.state.meeting().no;
    if (!meetingNo) return;
    this.publishedAgenda.publish(meetingNo, this.importExport.getSnapshot());
    this.published = true;
    setTimeout(() => (this.published = false), 2000);
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

  /** Applies the currently-loaded checkinState snapshot onto the agenda — assumes checkinState.loadMeeting() already ran for the right meeting. */
  private applyCheckinSnapshot() {
    const overridden = this.state.overriddenRoles();
    for (const [roleId, claim] of Object.entries(this.checkinState.roles())) {
      if (overridden.has(roleId)) continue;
      const name = claim?.name ?? '';
      if (name) {
        this.state.applyRolePerson(roleId, name);
        this.lastSyncedPersonByRole.set(roleId, name);
        continue;
      }
      const lastSynced = this.lastSyncedPersonByRole.get(roleId);
      if (lastSynced !== undefined) {
        if (this.state.getRolePerson(roleId) === lastSynced) {
          this.state.applyRolePerson(roleId, '');
        }
        this.lastSyncedPersonByRole.delete(roleId);
      }
      // else: never synced and still empty — leave whatever's there alone.
    }

    const existingNames = new Set(this.state.spks().map((s) => s.name.trim().toLowerCase()));
    for (const sp of this.checkinState.speakers()) {
      if (!sp.name.trim() || existingNames.has(sp.name.trim().toLowerCase())) continue;
      const { timeLo, timeHi } = this.parseTimePref(sp.timePref);
      this.state.addSpeaker({
        name: sp.name,
        title: sp.title,
        level: sp.level,
        evaluator: sp.evaluator?.name ?? '',
        timeLo,
        timeHi,
      });
    }
  }

  private parseTimePref(pref: string): Partial<{ timeLo: number; timeHi: number }> {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(pref?.trim() ?? '');
    return m ? { timeLo: Number(m[1]), timeHi: Number(m[2]) } : {};
  }

  async copyCheckinLink() {
    const meetingNo = this.state.meeting().no;
    if (!meetingNo) return;
    const tree = this.router.createUrlTree(['/checkin'], { queryParams: { meeting: meetingNo } });
    const url = window.location.origin + this.router.serializeUrl(tree);
    try {
      await navigator.clipboard.writeText(url);
      this.linkCopied = true;
      setTimeout(() => (this.linkCopied = false), 2000);
    } catch (err) {
      console.error(err);
      alert('Could not copy automatically — here is the check-in link:\n' + url);
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
