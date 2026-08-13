import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SignupStateService } from '../../services/signup-state.service';
import { AttendanceListComponent } from '../../components/attendance-list/attendance-list.component';
import { RoleBoardComponent } from '../../components/role-board/role-board.component';
import { SpeakerSignupComponent } from '../../components/speaker-signup/speaker-signup.component';
import { EvaluatorSlotsComponent } from '../../components/evaluator-slots/evaluator-slots.component';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    AttendanceListComponent,
    RoleBoardComponent,
    SpeakerSignupComponent,
    EvaluatorSlotsComponent,
  ],
  templateUrl: './signup.component.html',
})
export class SignupComponent {
  readonly state = inject(SignupStateService);
  nameInput = '';

  constructor() {
    this.nameInput = this.state.currentName();
  }

  get dateStr(): string {
    const d = this.state.meeting().date;
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  checkIn() {
    this.state.checkIn(this.nameInput);
  }
}
