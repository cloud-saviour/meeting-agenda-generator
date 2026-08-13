import { Component, inject } from '@angular/core';
import { SignupStateService } from '../../services/signup-state.service';
import { DEFAULT_ROLE_KEYS, ROLE_LABELS } from '../../models/signup.models';

@Component({
  selector: 'app-role-board',
  standalone: true,
  templateUrl: './role-board.component.html',
})
export class RoleBoardComponent {
  readonly state = inject(SignupStateService);
  readonly roleKeys = DEFAULT_ROLE_KEYS;
  readonly roleLabels = ROLE_LABELS;

  claimError: string | null = null;

  get roles() {
    return this.state.roles();
  }

  isMine(roleKey: string): boolean {
    return this.roles[roleKey]?.uid === this.state.currentUid;
  }

  isTaken(roleKey: string): boolean {
    const r = this.roles[roleKey];
    return !!(r && r.uid && r.uid !== this.state.currentUid);
  }

  claim(roleKey: string) {
    this.claimError = null;
    if (!this.state.currentName()) {
      this.claimError = 'Check in with your name first.';
      return;
    }
    const ok = this.state.claimRole(roleKey);
    if (!ok) {
      const owner = this.roles[roleKey]?.name || 'someone else';
      this.claimError = `Just taken by ${owner}.`;
    }
  }

  release(roleKey: string) {
    this.state.releaseRole(roleKey);
  }
}
