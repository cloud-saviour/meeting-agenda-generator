import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { RoleDefinitionService } from '../../../../core/services/role-definition.service';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-role-board',
  standalone: true,
  templateUrl: './role-board.component.html',
})
export class RoleBoardComponent {
  readonly state = inject(CheckinStateService);
  readonly roleDefs = inject(RoleDefinitionService);
  readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);
  readonly activeRoles = this.roleDefs.activeRoles;

  claimError: string | null = null;
  private readonly pendingRoleConfirm = new Set<string>();

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

  async claim(roleId: string) {
    this.claimError = null;
    if (!this.state.currentName()) {
      this.claimError = 'Check in with your name first.';
      return;
    }
    const ok = await this.state.claimRole(roleId);
    if (!ok) {
      const owner = this.roles[roleId]?.name || 'someone else';
      this.claimError = `Just taken by ${owner}.`;
    }
  }

  release(roleId: string) {
    this.state.releaseRole(roleId);
  }

  isRoleConfirmed(uid: string, roleId: string): boolean {
    return !!this.attendanceConfirmation.confirmationsForCurrentMeeting().get(uid)?.rolesConfirmed.includes(roleId);
  }

  /** Disables the button for this role while its write is in flight — without this, a slow or
   *  failed Firestore write looks identical to a click that did nothing. */
  isRoleConfirmPending(roleId: string): boolean {
    return this.pendingRoleConfirm.has(roleId);
  }

  async toggleRoleConfirm(roleId: string) {
    this.claimError = null;
    const uid = this.roles[roleId]?.uid;
    if (!uid) return;
    this.pendingRoleConfirm.add(roleId);
    try {
      const meeting = this.state.meeting();
      const meta = { date: meeting.date, theme: meeting.theme };
      await (this.isRoleConfirmed(uid, roleId)
        ? this.attendanceConfirmation.unconfirmRole(meeting.id, uid, roleId)
        : this.attendanceConfirmation.confirmRole(meeting.id, uid, roleId, meta));
    } catch {
      this.claimError = 'Could not update confirmation — try again.';
    } finally {
      this.pendingRoleConfirm.delete(roleId);
    }
  }
}
