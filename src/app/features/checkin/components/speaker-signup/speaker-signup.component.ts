import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-speaker-signup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './speaker-signup.component.html',
})
export class SpeakerSignupComponent {
  readonly state = inject(CheckinStateService);
  readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);

  title = '';
  level = '';
  timePref: '5-7' | '7-10' = '7-10';
  error: string | null = null;

  get speakers() {
    return this.state.speakers();
  }

  get isFull(): boolean {
    return this.speakers.length >= this.state.meeting().maxSpeakers;
  }

  get alreadySignedUp(): boolean {
    return this.speakers.some((s) => s.uid === this.state.currentUid);
  }

  async submit() {
    this.error = null;
    if (!this.state.currentName()) {
      this.error = 'Check in with your name first.';
      return;
    }
    if (!this.title.trim()) {
      this.error = 'Give your speech a title.';
      return;
    }
    const ok = await this.state.addSpeakerSignup({
      title: this.title,
      level: this.level,
      timePref: this.timePref,
    });
    if (!ok) {
      this.error = this.isFull ? 'All speaker slots are full.' : 'You already signed up to speak.';
      return;
    }
    this.title = '';
    this.level = '';
  }

  remove(id: string) {
    this.state.removeSpeakerSignup(id);
  }

  isMine(uid: string): boolean {
    return uid === this.state.currentUid;
  }

  isSpeechConfirmed(uid: string): boolean {
    return !!this.attendanceConfirmation.confirmationsForCurrentMeeting().get(uid)?.spoke;
  }

  toggleSpeechConfirm(uid: string) {
    const meeting = this.state.meeting();
    const meta = { date: meeting.date, theme: meeting.theme };
    this.isSpeechConfirmed(uid)
      ? this.attendanceConfirmation.unconfirmSpeech(meeting.id, uid)
      : this.attendanceConfirmation.confirmSpeech(meeting.id, uid, meta);
  }
}
