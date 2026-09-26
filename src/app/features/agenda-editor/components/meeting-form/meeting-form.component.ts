import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClubLinkPipe } from '../../../../core/club/club-link.pipe';
import { AgendaStateService } from '../../services/agenda-state.service';
import { addApology, parseApologies, removeApology } from '../../utils/apologies';

@Component({
  selector: 'app-meeting-form',
  standalone: true,
  imports: [FormsModule, RouterLink, ClubLinkPipe],
  templateUrl: './meeting-form.component.html',
})
export class MeetingFormComponent {
  readonly state = inject(AgendaStateService);

  /** Computed once per component lifetime — a session-spanning-midnight edge case isn't worth re-deriving on every change detection. */
  readonly todayStr = new Date().toISOString().slice(0, 10);
  dateError: string | null = null;

  get m() { return this.state.meeting(); }

  /** Name being typed into the Apologies box, before "Add". */
  newApology = '';

  /** The stored comma-separated `apologies` text as a list (also picks up names the check-in sync adds). */
  get apologyNames(): string[] { return parseApologies(this.m.apologies); }

  addApology() {
    this.state.updateMeeting({ apologies: addApology(this.m.apologies, this.newApology) });
    this.newApology = '';
  }

  removeApology(index: number) {
    this.state.updateMeeting({ apologies: removeApology(this.m.apologies, index) });
  }

  update(field: string, value: string) {
    this.state.updateMeeting({ [field]: value } as any);
  }

  /**
   * Only gates the interactive date field, not AgendaStateService.updateMeeting()
   * itself — reopening a saved/imported agenda with a genuine past date (an old
   * meeting) must keep working; this only stops setting a NEW past date by hand.
   */
  updateDate(value: string) {
    if (value && value < this.todayStr) {
      this.dateError = 'Meeting date can\'t be in the past.';
      return;
    }
    this.dateError = null;
    this.state.updateMeeting({ date: value });
  }
}
