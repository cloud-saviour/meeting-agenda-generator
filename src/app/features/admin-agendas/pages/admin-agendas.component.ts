import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SavedAgendaService } from '../../agenda-editor/services/saved-agenda.service';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { AgendaStateService } from '../../agenda-editor/services/agenda-state.service';
import { AgendaImportExportService } from '../../agenda-editor/services/agenda-import-export.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { APP_LOCALE } from '../../../core/utils/locale';

@Component({
  selector: 'app-admin-agendas',
  standalone: true,
  imports: [NavbarComponent],
  templateUrl: './admin-agendas.component.html',
})
export class AdminAgendasComponent {
  private readonly savedAgendas = inject(SavedAgendaService);
  private readonly publishedAgenda = inject(PublishedAgendaService);
  readonly state = inject(AgendaStateService);
  private readonly importExport = inject(AgendaImportExportService);
  private readonly checkinState = inject(CheckinStateService);
  private readonly router = inject(Router);

  readonly entries = this.savedAgendas.entries;

  private readonly pendingPublish = new Set<string>();
  publishError: string | null = null;

  async open(no: string) {
    const snapshot = await this.savedAgendas.load(no);
    if (!snapshot) return;
    this.importExport.loadSnapshot(snapshot);
    this.router.navigate(['/admin']);
  }

  /** Whether `no` is the currently published meeting — entries() is normally 0-1 elements now that publish() is exclusive. */
  isPublished(no: string): boolean {
    return this.publishedAgenda.entries().some((e) => e.no === no);
  }

  isPublishPending(no: string): boolean {
    return this.pendingPublish.has(no);
  }

  /**
   * Always re-runs even when already published — the saved draft and the
   * published snapshot are separate documents that can drift (editing the
   * draft afterward doesn't re-publish it), so this doubles as a "refresh
   * the published copy" action.
   */
  async publish(no: string) {
    this.publishError = null;
    this.pendingPublish.add(no);
    try {
      const snapshot = await this.savedAgendas.load(no);
      if (!snapshot) {
        this.publishError = 'Could not load this agenda — try again.';
        return;
      }
      await this.publishedAgenda.publish(no, snapshot);
    } catch {
      this.publishError = 'Could not publish this agenda — try again.';
    } finally {
      this.pendingPublish.delete(no);
    }
  }

  async unpublish(no: string) {
    this.publishError = null;
    this.pendingPublish.add(no);
    try {
      await this.publishedAgenda.unpublish(no);
    } finally {
      this.pendingPublish.delete(no);
    }
  }

  createNew() {
    this.state.resetAll();
    this.router.navigate(['/admin']);
  }

  remove(no: string) {
    if (!confirm(`Delete the saved agenda for meeting ${no} and its check-in data, and unpublish it if published? This can't be undone.`)) return;
    this.savedAgendas.delete(no);
    this.checkinState.deleteMeeting(no);
    this.publishedAgenda.unpublish(no);
  }

  formatUpdatedAt(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(APP_LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
