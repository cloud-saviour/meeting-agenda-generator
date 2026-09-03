import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SavedAgendaService } from '../../agenda-editor/services/saved-agenda.service';
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
  readonly state = inject(AgendaStateService);
  private readonly importExport = inject(AgendaImportExportService);
  private readonly checkinState = inject(CheckinStateService);
  private readonly router = inject(Router);

  readonly entries = this.savedAgendas.entries;

  open(no: string) {
    const snapshot = this.savedAgendas.load(no);
    if (!snapshot) return;
    this.importExport.loadSnapshot(snapshot);
    this.router.navigate(['/admin']);
  }

  createNew() {
    this.state.resetAll();
    this.router.navigate(['/admin']);
  }

  remove(no: string) {
    if (!confirm(`Delete the saved agenda for meeting ${no} and its check-in data? This can't be undone.`)) return;
    this.savedAgendas.delete(no);
    this.checkinState.deleteMeeting(no);
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
