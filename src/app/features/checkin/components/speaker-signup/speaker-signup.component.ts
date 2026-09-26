import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { ClubContextService } from '../../../../core/club/club-context.service';
import { CheckinSpeaker } from '../../models/checkin.models';

@Component({
  selector: 'app-speaker-signup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './speaker-signup.component.html',
})
export class SpeakerSignupComponent {
  readonly state = inject(CheckinStateService);
  readonly club = inject(ClubContextService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);

  title = '';
  level = '';
  /**
   * Free-form min/max, matching the Agenda Editor's own "Time (mins)"
   * input-group exactly (speakers-form.component.html) — this used to be a
   * fixed 5-7/7-10 dropdown, the only two choices available. Defaults
   * (7-10) match AgendaStateService.addSpeaker()'s own defaults for a new
   * speaker.
   */
  timeLo = 7;
  timeHi = 10;
  error: string | null = null;
  private readonly pendingSpeechConfirm = new Set<string>();

  editingSpeakerId: string | null = null;
  editTitle = '';
  editLevel = '';
  editTimeLo = 7;
  editTimeHi = 10;
  private readonly pendingSpeakerEdit = new Set<string>();

  get speakers() {
    return this.state.speakers();
  }

  get isFull(): boolean {
    return this.speakers.length >= this.state.meeting().maxSpeakers;
  }

  get alreadySignedUp(): boolean {
    return this.speakers.some((s) => s.uid === this.state.currentUid);
  }

  /** Explains the disabled sign-up button. A getter, not an inline template expression —
   *  the apostrophe in "I'm" can't survive Angular's template-expression parser. */
  get attendanceTooltip(): string {
    return this.state.isCheckedIn() ? '' : 'Tap "I\'m Attending" above first';
  }

  async submit() {
    this.error = null;
    if (!this.state.isCheckedIn()) {
      this.error = 'Tap "I\'m Attending" above before signing up to speak.';
      return;
    }
    if (!this.title.trim()) {
      this.error = 'Give your speech a title.';
      return;
    }
    const ok = await this.state.addSpeakerSignup({
      title: this.title,
      level: this.level,
      timePref: `${this.timeLo}-${this.timeHi}`,
    });
    if (!ok) {
      this.error = this.isFull ? 'All speaker slots are full.' : 'You already signed up to speak.';
      return;
    }
    this.title = '';
    this.level = '';
  }

  /** Mirrors AgendaStateService.updateSpeaker()'s own timeLo<=timeHi enforcement, for the same input-group UI. */
  onTimeLoChange() {
    if (this.timeLo > this.timeHi) this.timeHi = this.timeLo;
  }

  onTimeHiChange() {
    if (this.timeHi < this.timeLo) this.timeLo = this.timeHi;
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

  /** Disables the button for this speaker while its write is in flight — without this, a slow or
   *  failed Firestore write looks identical to a click that did nothing. */
  isSpeechConfirmPending(uid: string): boolean {
    return this.pendingSpeechConfirm.has(uid);
  }

  async toggleSpeechConfirm(uid: string) {
    this.error = null;
    this.pendingSpeechConfirm.add(uid);
    try {
      const meeting = this.state.meeting();
      const meta = { date: meeting.date, theme: meeting.theme };
      await (this.isSpeechConfirmed(uid)
        ? this.attendanceConfirmation.unconfirmSpeech(meeting.id, uid)
        : this.attendanceConfirmation.confirmSpeech(meeting.id, uid, meta));
    } catch {
      this.error = 'Could not update confirmation — try again.';
    } finally {
      this.pendingSpeechConfirm.delete(uid);
    }
  }

  startEditSpeaker(sp: Pick<CheckinSpeaker, 'id' | 'title' | 'level' | 'timePref'>) {
    this.editingSpeakerId = sp.id;
    this.editTitle = sp.title;
    this.editLevel = sp.level;
    const [lo, hi] = sp.timePref.split('-').map((n) => parseInt(n, 10));
    this.editTimeLo = Number.isFinite(lo) ? lo : 7;
    this.editTimeHi = Number.isFinite(hi) ? hi : 10;
  }

  cancelEditSpeaker() {
    this.editingSpeakerId = null;
  }

  onEditTimeLoChange() {
    if (this.editTimeLo > this.editTimeHi) this.editTimeHi = this.editTimeLo;
  }

  onEditTimeHiChange() {
    if (this.editTimeHi < this.editTimeLo) this.editTimeLo = this.editTimeHi;
  }

  isSpeakerEditPending(id: string): boolean {
    return this.pendingSpeakerEdit.has(id);
  }

  async saveEditSpeaker() {
    if (!this.editingSpeakerId) return;
    const title = this.editTitle.trim();
    if (!title) return;
    const id = this.editingSpeakerId;
    this.pendingSpeakerEdit.add(id);
    try {
      await this.state.adminEditSpeaker(id, {
        title,
        level: this.editLevel.trim(),
        timePref: `${this.editTimeLo}-${this.editTimeHi}`,
      });
      this.cancelEditSpeaker();
    } catch {
      this.error = 'Could not save changes — try again.';
    } finally {
      this.pendingSpeakerEdit.delete(id);
    }
  }
}
