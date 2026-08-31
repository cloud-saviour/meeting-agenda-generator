import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';
import { RoleDefinitionService } from '../../../../core/services/role-definition.service';

@Component({
  selector: 'app-role-board',
  standalone: true,
  templateUrl: './role-board.component.html',
})
export class RoleBoardComponent {
  readonly state = inject(CheckinStateService);
  readonly roleDefs = inject(RoleDefinitionService);
  readonly activeRoles = this.roleDefs.activeRoles;

  claimError: string | null = null;

  get roles() {
    return this.state.roles();
  }

  isMine(roleId: string): boolean {
    return this.roles[roleId]?.uid === this.state.currentUid;
  }

  isTaken(roleId: string): boolean {
    const r = this.roles[roleId];
    return !!(r && r.uid && r.uid !== this.state.currentUid);
  }

  isLocked(roleId: string): boolean {
    return this.state.lockedRoles().includes(roleId);
  }

  claim(roleId: string) {
    this.claimError = null;
    if (!this.state.currentName()) {
      this.claimError = 'Check in with your name first.';
      return;
    }
    const ok = this.state.claimRole(roleId);
    if (!ok) {
      const owner = this.roles[roleId]?.name || 'someone else';
      this.claimError = `Just taken by ${owner}.`;
    }
  }

  release(roleId: string) {
    this.state.releaseRole(roleId);
  }
}
