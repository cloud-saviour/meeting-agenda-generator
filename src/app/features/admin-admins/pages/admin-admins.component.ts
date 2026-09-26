import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppAdminService } from '../services/app-admin.service';
import { MembershipService } from '../../membership/services/membership.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubLinkPipe } from '../../../core/club/club-link.pipe';

/** A person on this page: an approved member of this club, and/or someone already granted admin for it. */
export interface AdminRow {
  uid: string;
  email: string;
  displayName: string;
  /** False for someone who was granted admin but is not (or no longer) an approved member. */
  isMember: boolean;
}

/**
 * Route guarded by clubAdminGuard — any admin of THIS club (real claim or
 * granted) can grant/revoke another person's admin access to this club.
 * Candidates are this club's approved members (see MembershipService), plus
 * anyone already granted here so they can still be revoked. The one thing
 * still blocked for everyone is granting yourself (see isSelf() and
 * firestore.rules' appAdmins rule).
 */
@Component({
  selector: 'app-admin-admins',
  standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent, ClubLinkPipe],
  templateUrl: './admin-admins.component.html',
})
export class AdminAdminsComponent implements OnInit {
  readonly appAdmins = inject(AppAdminService);
  private readonly membership = inject(MembershipService);
  private readonly auth = inject(AuthService);

  private readonly approvedMembers = signal<AdminRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly filter = signal('');
  readonly pendingUids = signal<ReadonlySet<string>>(new Set());

  /** Approved members plus anyone granted admin here, one row per person, sorted by name. */
  readonly rows = computed<AdminRow[]>(() => {
    const byUid = new Map<string, AdminRow>();
    for (const m of this.approvedMembers()) byUid.set(m.uid, m);
    for (const a of this.appAdmins.all()) {
      if (!byUid.has(a.uid)) byUid.set(a.uid, { uid: a.uid, email: a.email, displayName: a.displayName, isMember: false });
    }
    return [...byUid.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  readonly visibleRows = computed<AdminRow[]>(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((r) => r.displayName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  });

  async ngOnInit(): Promise<void> {
    try {
      const all = await this.membership.listForClub();
      this.approvedMembers.set(
        all.filter((m) => m.status === 'active').map((m) => ({ uid: m.uid, email: m.email, displayName: m.displayName, isMember: true }))
      );
    } catch {
      this.loadError.set('Could not load this club\'s members — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }

  isGranted(uid: string): boolean {
    return this.appAdmins.isGranted(uid);
  }

  /** Grant is blocked for your own row — see firestore.rules' appAdmins create/update restriction and its comment on why self-granting is a footgun, not a convenience. */
  isSelf(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  isPending(uid: string): boolean {
    return this.pendingUids().has(uid);
  }

  async grant(row: AdminRow): Promise<void> {
    if (this.isSelf(row.uid)) return;
    await this.run(row, () => this.appAdmins.grant(row.uid, row.email, row.displayName), `Could not grant admin access to ${row.email} — try again.`);
  }

  async revoke(row: AdminRow): Promise<void> {
    await this.run(row, () => this.appAdmins.revoke(row.uid, row.email, row.displayName), `Could not revoke admin access for ${row.email} — try again.`);
  }

  private async run(row: AdminRow, action: () => Promise<void>, errorMessage: string): Promise<void> {
    this.actionError.set(null);
    this.pendingUids.update((s) => new Set(s).add(row.uid));
    try {
      await action();
    } catch {
      this.actionError.set(errorMessage);
    } finally {
      this.pendingUids.update((s) => {
        const next = new Set(s);
        next.delete(row.uid);
        return next;
      });
    }
  }
}
