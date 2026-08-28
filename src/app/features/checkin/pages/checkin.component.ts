import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CheckinStateService } from '../services/checkin-state.service';
import { AttendanceListComponent } from '../components/attendance-list/attendance-list.component';
import { RoleBoardComponent } from '../components/role-board/role-board.component';
import { SpeakerSignupComponent } from '../components/speaker-signup/speaker-signup.component';
import { EvaluatorSlotsComponent } from '../components/evaluator-slots/evaluator-slots.component';
import { APP_LOCALE } from '../../../core/utils/locale';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-checkin',
  standalone: true,
  imports: [
    FormsModule,
    NavbarComponent,
    AttendanceListComponent,
    RoleBoardComponent,
    SpeakerSignupComponent,
    EvaluatorSlotsComponent,
  ],
  templateUrl: './checkin.component.html',
})
export class CheckinComponent {
  readonly state = inject(CheckinStateService);
  private readonly route = inject(ActivatedRoute);
  nameInput = '';

  constructor() {
    const meetingId = this.route.snapshot.queryParamMap.get('meeting') ?? 'default';
    this.state.loadMeeting(meetingId);
    this.nameInput = this.state.currentName();
  }

  get dateStr(): string {
    const d = this.state.meeting().date;
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  checkIn() {
    this.state.checkIn(this.nameInput);
  }
}
