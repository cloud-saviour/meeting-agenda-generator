import { Component, inject } from '@angular/core';
import { SignupStateService } from '../../services/signup-state.service';

@Component({
  selector: 'app-evaluator-slots',
  standalone: true,
  templateUrl: './evaluator-slots.component.html',
})
export class EvaluatorSlotsComponent {
  readonly state = inject(SignupStateService);
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

  claim(speakerId: string) {
    this.error = null;
    if (!this.state.currentName()) {
      this.error = 'Check in with your name first.';
      return;
    }
    const ok = this.state.claimEvaluatorSlot(speakerId);
    if (!ok) {
      this.error = 'You can evaluate only one speech, and not your own.';
    }
  }

  release(speakerId: string) {
    this.state.releaseEvaluatorSlot(speakerId);
  }
}
