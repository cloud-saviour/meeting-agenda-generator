import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { MemberProfileService } from '../services/member-profile.service';
import { MemberHistoryService } from '../services/member-history.service';
import { MemberHistoryEntry, MemberProfile } from '../models/member.models';
import { NavbarComponent, NavLink } from '../../../layout/navbar/navbar.component';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';

@Component({
  selector: 'app-member-dashboard',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './member-dashboard.component.html',
})
export class MemberDashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly memberProfile = inject(MemberProfileService);
  private readonly memberHistory = inject(MemberHistoryService);
  private readonly publishedAgenda = inject(PublishedAgendaService);

  /**
   * Both "Preview Agenda" and "Meeting Check-in" only appear when a meeting is
   * currently published — same visitor-facing gating as Home's tile, since a
   * member with nothing published has nowhere to go for either. Preview must
   * carry the meeting number for the same reason check-in does: a bare
   * /preview resolves the missing `?meeting=` to the id 'default' and shows
   * the not-published fallback even when a meeting really is published.
   */
  get navLinks(): NavLink[] {
    const links: NavLink[] = [];
    const meeting = this.publishedAgenda.nearestEntry();
    if (meeting) {
      links.push(
        { label: '👁 Preview Agenda', path: '/preview', queryParams: { meeting: meeting.no } },
        { label: '✅ Meeting Check-in', path: '/checkin', queryParams: { meeting: meeting.no } }
      );
    }
    links.push({ label: '🏠 Home', path: '/' });
    return links;
  }

  readonly profile = signal<MemberProfile | null>(null);
  readonly profileLoaded = signal(false);
  readonly history = signal<MemberHistoryEntry[]>([]);
  readonly editing = signal(false);
  readonly editError = signal<string | null>(null);
  displayNameInput = '';
  busy = false;

  constructor() {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    this.memberProfile.getProfile(uid).then((profile) => {
      this.profile.set(profile);
      this.profileLoaded.set(true);
      this.displayNameInput = profile?.displayName ?? this.auth.currentUser()?.displayName ?? '';
    });
    this.memberHistory.loadHistory(uid).then((entries) => this.history.set(entries));
  }

  startEdit() {
    this.editError.set(null);
    this.editing.set(true);
  }

  /**
   * Handles an account that reached /member without ever going through
   * /signup — e.g. an admin account, which memberGuard also lets through.
   * Trims displayName/email before the `||` fallback chain — a
   * whitespace-only displayName (e.g. " ") is truthy in JS and would
   * otherwise short-circuit the chain instead of falling through to email
   * or the literal 'Member', tripping MemberProfileService's own
   * requireDisplayName() check with nothing here to catch it.
   */
  async createMissingProfile() {
    const user = this.auth.currentUser();
    if (!user) return;
    this.busy = true;
    try {
      const name = (user.displayName ?? '').trim() || (user.email ?? '').trim() || 'Member';
      await this.memberProfile.createProfile(user.uid, user.email ?? '', name);
      this.profile.set(await this.memberProfile.getProfile(user.uid));
      this.displayNameInput = name;
    } finally {
      this.busy = false;
    }
  }

  async saveEdit() {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    this.editError.set(null);
    const name = this.displayNameInput.trim();
    if (!name) {
      this.editError.set('Name cannot be empty.');
      return;
    }

    this.busy = true;
    try {
      await this.memberProfile.updateProfile(uid, { displayName: name });
      this.profile.update((p) => (p ? { ...p, displayName: name } : p));
      this.editing.set(false);
    } catch {
      this.editError.set('Could not save your name. Try again.');
    } finally {
      this.busy = false;
    }
  }
}
