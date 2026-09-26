import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubProvisioningService, SlugTakenError } from '../../../core/club/club-provisioning.service';
import { CLUB_SLUG_MAX_LENGTH, isValidClubSlug, suggestClubSlug } from '../../../core/club/club-slug.util';
import { MemberProfileService } from '../../member/services/member-profile.service';
import { MemberProfile } from '../../member/models/member.models';

/**
 * Platform-admin-only (route guarded by superAdminGuard; firestore.rules
 * enforces the real global claim server-side): creates a club, its slug, the
 * standard roles and an optional first club admin in one atomic batch — see
 * ClubProvisioningService. Lives outside `/c/<slug>/...` because it belongs
 * to no club.
 */
@Component({
  selector: 'app-create-club',
  standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent],
  templateUrl: './create-club.component.html',
})
export class CreateClubComponent implements OnInit {
  private readonly provisioning = inject(ClubProvisioningService);
  private readonly memberProfile = inject(MemberProfileService);

  readonly slugMaxLength = CLUB_SLUG_MAX_LENGTH;

  readonly name = signal('');
  readonly slug = signal('');
  readonly subLine = signal('');
  readonly addressLine = signal('');
  readonly firstAdminUid = signal('');

  readonly members = signal<MemberProfile[]>([]);
  readonly slugTaken = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly createdSlug = signal<string | null>(null);

  /** Until the admin edits the slug by hand, it follows the name. */
  private slugEditedByHand = false;

  readonly slugValid = computed(() => isValidClubSlug(this.slug()));
  readonly canSubmit = computed(
    () => this.name().trim().length > 0 && this.slugValid() && !this.slugTaken() && !this.submitting()
  );

  async ngOnInit(): Promise<void> {
    try {
      const all = await this.memberProfile.listAll();
      this.members.set(all.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch {
      // The first-admin picker is optional — the club can still be created without it.
    }
  }

  onNameChange(value: string): void {
    this.name.set(value);
    if (!this.slugEditedByHand) {
      this.slug.set(suggestClubSlug(value));
      this.slugTaken.set(false);
    }
  }

  onSlugChange(value: string): void {
    this.slugEditedByHand = true;
    this.slug.set(value.trim().toLowerCase());
    this.slugTaken.set(false);
  }

  async checkSlug(): Promise<void> {
    if (!this.slugValid()) return;
    try {
      this.slugTaken.set(await this.provisioning.isSlugTaken(this.slug()));
    } catch {
      // Best-effort hint only — createClub() re-checks, and firestore.rules is the real guard.
    }
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      const admin = this.members().find((m) => m.uid === this.firstAdminUid());
      const slug = await this.provisioning.createClub({
        slug: this.slug(),
        name: this.name(),
        subLine: this.subLine(),
        addressLine: this.addressLine(),
        firstAdmin: admin ? { uid: admin.uid, email: admin.email, displayName: admin.displayName } : undefined,
      });
      this.createdSlug.set(slug);
    } catch (err) {
      if (err instanceof SlugTakenError) {
        this.slugTaken.set(true);
      } else {
        console.error('createClub failed', err);
        this.error.set('Could not create the club. Only platform admins can do this — check your connection and try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }

  createAnother(): void {
    this.createdSlug.set(null);
    this.name.set('');
    this.slug.set('');
    this.subLine.set('');
    this.addressLine.set('');
    this.firstAdminUid.set('');
    this.slugEditedByHand = false;
    this.slugTaken.set(false);
  }
}
