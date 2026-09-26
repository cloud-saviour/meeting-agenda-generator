import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubDirectoryService, ClubRecord } from '../../../core/club/club-directory.service';
import { MemberProfileService } from '../../member/services/member-profile.service';
import { MemberProfile } from '../../member/models/member.models';
import { ClubMembership, MembershipService } from '../../membership/services/membership.service';

interface ClubChip {
  club: ClubRecord;
  membership: ClubMembership;
}

interface MemberRow {
  member: MemberProfile;
  chips: ClubChip[];
  /** Active clubs this person could be added to — everything they're not already an active member of. */
  addable: ClubRecord[];
}

/**
 * Platform-admin-only (route guarded by superAdminGuard): every account, the
 * clubs each one belongs to, and a way to add someone to a club directly,
 * already active, without the request/approval step. firestore.rules lets
 * only the real global claim create an `active` row for someone else.
 */
@Component({
  selector: 'app-all-members',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './all-members.component.html',
})
export class AllMembersComponent implements OnInit {
  private readonly profiles = inject(MemberProfileService);
  private readonly directory = inject(ClubDirectoryService);
  private readonly membership = inject(MembershipService);
  private readonly auth = inject(AuthService);

  private readonly members = signal<MemberProfile[]>([]);
  private readonly clubs = signal<ClubRecord[]>([]);
  private readonly memberships = signal<ClubMembership[]>([]);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly filter = signal('');
  /** uid -> clubId currently chosen in that row's "Add to club" picker. */
  readonly selection = signal<Record<string, string>>({});
  readonly busyUids = signal<ReadonlySet<string>>(new Set());

  readonly rows = computed<MemberRow[]>(() => {
    const q = this.filter().trim().toLowerCase();
    const clubById = new Map(this.clubs().map((c) => [c.id, c]));
    const activeClubs = this.clubs().filter((c) => c.active);
    return this.members()
      .filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .map((member) => {
        const chips = this.memberships()
          .filter((m) => m.uid === member.uid && clubById.has(m.clubId))
          .map((m) => ({ club: clubById.get(m.clubId)!, membership: m }))
          .sort((a, b) => a.club.name.localeCompare(b.club.name));
        const activeIds = new Set(chips.filter((c) => c.membership.status === 'active').map((c) => c.club.id));
        return { member, chips, addable: activeClubs.filter((c) => !activeIds.has(c.id)) };
      });
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  choose(uid: string, clubId: string): void {
    this.selection.update((s) => ({ ...s, [uid]: clubId }));
  }

  isBusy(uid: string): boolean {
    return this.busyUids().has(uid);
  }

  /** You can't remove yourself — firestore.rules blocks an admin deciding on their own row. */
  canRemove(uid: string): boolean {
    return this.auth.currentUser()?.uid !== uid;
  }

  async remove(row: MemberRow, chip: ClubChip): Promise<void> {
    if (!confirm(`Remove ${row.member.displayName} from ${chip.club.name}? They can ask to rejoin.`)) return;
    this.actionError.set(null);
    this.busyUids.update((s) => new Set(s).add(row.member.uid));
    try {
      await this.membership.removeFromClub(chip.club.id, row.member);
      await this.reload();
    } catch (err) {
      console.error('removeFromClub failed', err);
      this.actionError.set(`Could not remove ${row.member.displayName} from ${chip.club.name} — please try again.`);
    } finally {
      this.busyUids.update((s) => {
        const next = new Set(s);
        next.delete(row.member.uid);
        return next;
      });
    }
  }

  async add(row: MemberRow): Promise<void> {
    const clubId = this.selection()[row.member.uid];
    if (!clubId) return;
    const existing = row.chips.find((c) => c.club.id === clubId)?.membership;
    this.actionError.set(null);
    this.busyUids.update((s) => new Set(s).add(row.member.uid));
    try {
      await this.membership.assignToClub(clubId, row.member, existing);
      this.selection.update((s) => ({ ...s, [row.member.uid]: '' }));
      await this.reload();
    } catch (err) {
      console.error('assignToClub failed', err);
      this.actionError.set(`Could not add ${row.member.displayName} — please try again.`);
    } finally {
      this.busyUids.update((s) => {
        const next = new Set(s);
        next.delete(row.member.uid);
        return next;
      });
    }
  }

  private async reload(): Promise<void> {
    try {
      const [members, clubs, memberships] = await Promise.all([
        this.profiles.listAll(),
        this.directory.listClubs(),
        this.membership.listAllMemberships(),
      ]);
      this.members.set(members.sort((a, b) => a.displayName.localeCompare(b.displayName)));
      this.clubs.set(clubs);
      this.memberships.set(memberships);
      this.loadError.set(null);
    } catch (err) {
      console.error('all members load failed', err);
      this.loadError.set('Could not load the members — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }
}
