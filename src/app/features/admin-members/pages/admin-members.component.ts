import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { MembershipService } from '../../membership/services/membership.service';
import { Membership, MembershipDecision } from '../../membership/models/membership.models';

/**
 * Club-admin page (route under `admin`, guarded by clubAdminGuard): approve
 * or reject join requests and remove active members of the CURRENT club.
 * firestore.rules stops an admin deciding on their own membership row, and
 * the buttons are hidden for it too.
 */
@Component({
  selector: 'app-admin-members',
  standalone: true,
  imports: [NavbarComponent],
  templateUrl: './admin-members.component.html',
})
export class AdminMembersComponent implements OnInit {
  private readonly membership = inject(MembershipService);
  private readonly auth = inject(AuthService);

  readonly members = signal<Membership[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly pendingUids = signal<ReadonlySet<string>>(new Set());

  readonly pending = computed(() => this.members().filter((m) => m.status === 'pending'));
  readonly active = computed(() => this.members().filter((m) => m.status === 'active'));
  readonly past = computed(() => this.members().filter((m) => m.status === 'rejected' || m.status === 'removed'));

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  isSelf(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  isBusy(uid: string): boolean {
    return this.pendingUids().has(uid);
  }

  async decide(member: Membership, decision: MembershipDecision): Promise<void> {
    if (decision === 'removed' && !confirm(`Remove ${member.displayName} from this club? They can ask to rejoin.`)) return;
    this.actionError.set(null);
    this.pendingUids.update((s) => new Set(s).add(member.uid));
    try {
      await this.membership.decide(member, decision);
      await this.reload();
    } catch (err) {
      console.error('membership decision failed', err);
      this.actionError.set(`Could not update ${member.displayName} — please try again.`);
    } finally {
      this.pendingUids.update((s) => {
        const next = new Set(s);
        next.delete(member.uid);
        return next;
      });
    }
  }

  private async reload(): Promise<void> {
    try {
      this.members.set(await this.membership.listForClub());
      this.loadError.set(null);
    } catch (err) {
      console.error('listForClub failed', err);
      this.loadError.set('Could not load the members — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }
}
