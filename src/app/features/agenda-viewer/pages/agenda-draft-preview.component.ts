import { Component, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SavedAgendaService } from '../../agenda-editor/services/saved-agenda.service';
import { AgendaImportExportService } from '../../agenda-editor/services/agenda-import-export.service';
import { AgendaStateService } from '../../agenda-editor/services/agenda-state.service';
import { CheckinAgendaSyncService } from '../../agenda-editor/services/checkin-agenda-sync.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';
import { AgendaPreviewComponent } from '../../agenda-editor/components/agenda-preview/agenda-preview.component';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

/**
 * Admin-only preview of a SAVED agenda draft — reached from "My Agendas"'
 * Preview button, works regardless of publish state (unlike the public
 * `/preview`, which only ever shows the currently published meeting).
 * Guarded by `authGuard` (nested under `/admin` — see app.routes.ts) since
 * `savedAgendas` is admin-read-only per firestore.rules; nothing here is
 * reachable by a signed-out visitor or a non-admin member.
 *
 * The draft itself loads once (`SavedAgendaService.load()`, the same
 * one-time `getDoc()` `AdminAgendasComponent.open()` already uses) rather
 * than a live subscription — mirrors "opening a draft hydrates once" from
 * that same component. Check-in activity for this meeting number is still
 * merged in live on top (`CheckinAgendaSyncService`, the same merge
 * `AgendaViewerComponent` applies to published agendas), so previewing a
 * draft that's already accepting check-ins shows current claims/signups,
 * not just whatever was last saved.
 */
@Component({
  selector: 'app-agenda-draft-preview',
  standalone: true,
  imports: [NavbarComponent, AgendaPreviewComponent],
  templateUrl: './agenda-draft-preview.component.html',
})
export class AgendaDraftPreviewComponent {
  private readonly savedAgendas = inject(SavedAgendaService);
  private readonly importExport = inject(AgendaImportExportService);
  private readonly state = inject(AgendaStateService);
  private readonly checkinState = inject(CheckinStateService);
  private readonly checkinSync = inject(CheckinAgendaSyncService);
  private readonly route = inject(ActivatedRoute);

  meetingId: string;
  loading = true;
  found = false;

  constructor() {
    // `||`, not `??` — an empty-but-present `?meeting=` must fall back to 'default' too.
    this.meetingId = this.route.snapshot.queryParamMap.get('meeting') || 'default';
    this.checkinState.loadMeeting(this.meetingId);
    this.loadDraft();

    // Live check-in sync, mirroring AgendaViewerComponent's own — re-merges
    // every time a claim/signup/apology lands from any device, so an admin
    // previewing a draft against a meeting that's already accepting
    // check-ins sees current activity, not just what was last saved.
    // No-ops via the `found` guard until the one-time load above completes.
    effect(() => {
      this.checkinState.roles();
      this.checkinState.speakers();
      this.checkinState.apologies();
      untracked(() => {
        if (!this.found) return;
        this.checkinSync.apply(this.meetingId, this.state, this.checkinState);
      });
    });
  }

  private async loadDraft(): Promise<void> {
    this.loading = true;
    const snapshot = await this.savedAgendas.load(this.meetingId);
    if (snapshot) {
      this.importExport.loadSnapshot(snapshot);
      this.checkinSync.apply(this.meetingId, this.state, this.checkinState);
      this.found = true;
    } else {
      this.found = false;
    }
    this.loading = false;
  }

  /** Re-runs the one-time draft load — there's no live listener here to fall back on. */
  refresh(): void {
    this.loadDraft();
  }
}
