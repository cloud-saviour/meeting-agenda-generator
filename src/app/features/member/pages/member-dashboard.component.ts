import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { MemberProfileService } from '../services/member-profile.service';
import { MemberHistoryService } from '../services/member-history.service';
import { MemberHistoryEntry, MemberProfile } from '../models/member.models';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

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

  readonly profile = signal<MemberProfile | null>(null);
  readonly profileLoaded = signal(false);
  readonly history = signal<MemberHistoryEntry[]>([]);
  readonly editing = signal(false);
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
    this.editing.set(true);
  }

  /** Handles an account that reached /member without ever going through /signup — e.g. an admin account, which memberGuard also lets through. */
  async createMissingProfile() {
    const user = this.auth.currentUser();
    if (!user) return;
    this.busy = true;
    try {
      const name = user.displayName || user.email || 'Member';
      await this.memberProfile.createProfile(user.uid, user.email ?? '', name);
      this.profile.set(await this.memberProfile.getProfile(user.uid));
      this.displayNameInput = name;
    } finally {
      this.busy = false;
    }
  }

  async saveEdit() {
    const uid = this.auth.currentUser()?.uid;
    const name = this.displayNameInput.trim();
    if (!uid || !name) return;

    this.busy = true;
    try {
      await this.memberProfile.updateProfile(uid, { displayName: name });
      this.profile.update((p) => (p ? { ...p, displayName: name } : p));
      this.editing.set(false);
    } finally {
      this.busy = false;
    }
  }
}
