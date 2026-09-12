import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppAdminService } from '../services/app-admin.service';
import { MemberProfileService } from '../../member/services/member-profile.service';
import { MemberProfile } from '../../member/models/member.models';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Route guarded by authGuard — any app-admin (real claim or granted) can
 * reach this page and grant/revoke another member's access, not just a
 * true claim-holder. The one thing still blocked for everyone is granting
 * yourself (see isSelf() below and firestore.rules' appAdmins rule).
 */
@Component({
  selector: 'app-admin-admins',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './admin-admins.component.html',
})
export class AdminAdminsComponent implements OnInit {
  readonly appAdmins = inject(AppAdminService);
  private readonly memberProfile = inject(MemberProfileService);
  private readonly auth = inject(AuthService);

  readonly members = signal<MemberProfile[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly filter = signal('');

  private readonly pendingUids = new Set<string>();

  async ngOnInit(): Promise<void> {
    try {
      const all = await this.memberProfile.listAll();
      this.members.set(all.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch {
      this.loadError.set('Could not load the member list — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }

  get visibleMembers(): MemberProfile[] {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.members();
    return this.members().filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }

  isGranted(uid: string): boolean {
    return this.appAdmins.isGranted(uid);
  }

  /** Grant is blocked for your own row — see firestore.rules' appAdmins create/update restriction and its comment on why self-granting is a footgun, not a convenience. */
  isSelf(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  isPending(uid: string): boolean {
    return this.pendingUids.has(uid);
  }

  async grant(member: MemberProfile): Promise<void> {
    if (this.isSelf(member.uid)) return;
    this.actionError.set(null);
    this.pendingUids.add(member.uid);
    try {
      await this.appAdmins.grant(member.uid, member.email, member.displayName);
    } catch {
      this.actionError.set(`Could not grant admin access to ${member.email} — try again.`);
    } finally {
      this.pendingUids.delete(member.uid);
    }
  }

  async revoke(member: MemberProfile): Promise<void> {
    this.actionError.set(null);
    this.pendingUids.add(member.uid);
    try {
      await this.appAdmins.revoke(member.uid, member.email, member.displayName);
    } catch {
      this.actionError.set(`Could not revoke admin access for ${member.email} — try again.`);
    } finally {
      this.pendingUids.delete(member.uid);
    }
  }
}
