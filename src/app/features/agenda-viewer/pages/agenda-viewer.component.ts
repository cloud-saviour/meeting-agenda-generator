import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { AgendaImportExportService } from '../../agenda-editor/services/agenda-import-export.service';
import { AgendaPreviewComponent } from '../../agenda-editor/components/agenda-preview/agenda-preview.component';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

/**
 * Member-facing, read-only view of a published agenda — reached from the
 * check-in page's "Preview Agenda" link. Hydrates the shared
 * AgendaStateService from the published snapshot for this meeting, then
 * reuses AgendaPreviewComponent unchanged for the actual rendering.
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
  private readonly route = inject(ActivatedRoute);

  meetingId: string;
  found = false;
  refreshed = false;

  constructor() {
    // `||`, not `??` — an empty-but-present `?meeting=` must fall back to 'default' too.
    this.meetingId = this.route.snapshot.queryParamMap.get('meeting') || 'default';
    this.publishedAgenda.loadMeeting(this.meetingId);

    // Reactive, not a one-time synchronous read — current() only gets its
    // real value once Firestore's onSnapshot delivers, and updates live from
    // then on too (e.g. if the admin re-publishes while this page is open).
    effect(() => {
      const snapshot = this.publishedAgenda.current();
      if (snapshot) {
        this.importExport.loadSnapshot(snapshot);
        this.found = true;
      } else {
        this.found = false;
      }
    });
  }

  /** Data is already live via Firestore — this just reassures the viewer nothing's stale. */
  refresh() {
    this.refreshed = true;
    setTimeout(() => (this.refreshed = false), 2000);
  }
}
