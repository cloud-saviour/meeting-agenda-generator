import { Component, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { AgendaImportExportService } from '../../agenda-editor/services/agenda-import-export.service';
import { AgendaStateService } from '../../agenda-editor/services/agenda-state.service';
import { CheckinAgendaSyncService } from '../../agenda-editor/services/checkin-agenda-sync.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';
import { AgendaPreviewComponent } from '../../agenda-editor/components/agenda-preview/agenda-preview.component';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

/**
 * Member-facing, read-only view of a published agenda — reached from the
 * check-in page's "Preview Agenda" link. Hydrates the shared
 * AgendaStateService from the published snapshot for this meeting, then
 * reuses AgendaPreviewComponent unchanged for the actual rendering.
 *
 * The published snapshot is frozen at publish time, so on its own it would
 * go stale the moment anyone claims a role or signs up to speak. This page
 * therefore also subscribes to the same meeting's live check-in sheet and
 * merges it on top (CheckinAgendaSyncService — the same merge the Agenda
 * Editor applies), so a viewer sees check-in activity without an admin
 * needing to have the editor open to republish. Nothing is written back:
 * publishedAgendas stays admin-write-only, the merge is display-only.
 */
@Component({
  selector: 'app-agenda-viewer',
  standalone: true,
  imports: [NavbarComponent, AgendaPreviewComponent],
  templateUrl: './agenda-viewer.component.html',
})
export class AgendaViewerComponent {
  private readonly publishedAgenda = inject(PublishedAgendaService);
  private readonly importExport = inject(AgendaImportExportService);
  private readonly state = inject(AgendaStateService);
  private readonly checkinState = inject(CheckinStateService);
  private readonly checkinSync = inject(CheckinAgendaSyncService);
  private readonly route = inject(ActivatedRoute);

  meetingId: string;
  found = false;
  refreshing = false;
  refreshed = false;
  refreshError = false;

  constructor() {
    // `||`, not `??` — an empty-but-present `?meeting=` must fall back to 'default' too.
    this.meetingId = this.route.snapshot.queryParamMap.get('meeting') || 'default';
    this.publishedAgenda.loadMeeting(this.meetingId);
    this.checkinState.loadMeeting(this.meetingId);

    // Reactive, not a one-time synchronous read — current() only gets its
    // real value once Firestore's onSnapshot delivers, and updates live from
    // then on too (e.g. if the admin re-publishes while this page is open).
    effect(() => {
      const snapshot = this.publishedAgenda.current();
      if (snapshot) {
        untracked(() => {
          this.importExport.loadSnapshot(snapshot);
          // loadSnapshot() resets the agenda to exactly what was published,
          // discarding any check-in merge already applied — so re-merge here
          // rather than waiting for check-in's next change, which may never
          // come (nothing guarantees check-in data arrives after the
          // published snapshot; either order is a real possibility since both
          // are independent async Firestore listeners). Untracked because
          // apply() reads check-in's signals, which must drive the dedicated
          // effect below, not this one.
          this.checkinSync.apply(this.meetingId, this.state, this.checkinState);
        });
        this.found = true;
      } else {
        this.found = false;
      }
    });

    // Live check-in sync, mirroring AgendaEditorComponent's own — re-merges
    // every time a claim/signup/apology lands from any device, so this
    // read-only page stays current without a reload.
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

  /**
   * A genuine network round-trip (PublishedAgendaService.refetch(), which
   * uses getDocFromServer() — bypasses the local cache), not just a
   * reassurance no-op — data is already live via loadMeeting()'s listener
   * in the normal case, but this gives a real way to force a fresh read if
   * that listener ever silently stalls (e.g. a long-backgrounded tab).
   */
  async refresh() {
    this.refreshing = true;
    this.refreshError = false;
    try {
      await this.publishedAgenda.refetch(this.meetingId);
      this.refreshed = true;
      setTimeout(() => (this.refreshed = false), 2000);
    } catch {
      this.refreshError = true;
      setTimeout(() => (this.refreshError = false), 2000);
    } finally {
      this.refreshing = false;
    }
  }
}
