import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-evaluator-slots',
  standalone: true,
  templateUrl: './evaluator-slots.component.html',
})
export class EvaluatorSlotsComponent {
  readonly state = inject(CheckinStateService);
  readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);
  error: string | null = null;

  get speakers() {
    return this.state.speakers();
  }

  isMine(uid: string | undefined): boolean {
    return uid === this.state.currentUid;
  }

  isSpeakerSelf(speakerUid: string): boolean {
    return speakerUid === this.state.currentUid;
  }

  async claim(speakerId: string) {
    this.error = null;
    if (!this.state.currentName()) {
      this.error = 'Check in with your name first.';
      return;
    }
    const ok = await this.state.claimEvaluatorSlot(speakerId);
    if (!ok) {
      this.error = 'You can evaluate only one speech, and not your own.';
    }
  }

  release(speakerId: string) {
    this.state.releaseEvaluatorSlot(speakerId);
  }

  isEvaluationConfirmed(evaluatorUid: string | undefined, speakerId: string): boolean {
    if (!evaluatorUid) return false;
    return this.attendanceConfirmation.confirmationsForCurrentMeeting().get(evaluatorUid)?.evaluatedSpeakerId === speakerId;
  }

  toggleEvaluationConfirm(speakerId: string) {
    const evaluatorUid = this.speakers.find((sp) => sp.id === speakerId)?.evaluator?.uid;
    if (!evaluatorUid) return;
    const meeting = this.state.meeting();
    const meta = { date: meeting.date, theme: meeting.theme };
    this.isEvaluationConfirmed(evaluatorUid, speakerId)
      ? this.attendanceConfirmation.unconfirmEvaluation(meeting.id, evaluatorUid)
      : this.attendanceConfirmation.confirmEvaluation(meeting.id, evaluatorUid, speakerId, meta);
  }
}
