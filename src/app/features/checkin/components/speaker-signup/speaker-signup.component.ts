import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckinStateService } from '../../services/checkin-state.service';

@Component({
  selector: 'app-speaker-signup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './speaker-signup.component.html',
})
export class SpeakerSignupComponent {
  readonly state = inject(CheckinStateService);

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
}
