import { Component, computed, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubContextService } from '../../../core/club/club-context.service';
import { ClubDirectoryService, ClubEditableFields, ClubRecord } from '../../../core/club/club-directory.service';
import { ClubDetailsFormComponent } from '../components/club-details-form.component';

/**
 * A club admin's own club settings (`/c/<slug>/admin/club`, behind
 * clubAdminGuard). Edits the CURRENT club only — there is no slug parameter to
 * point it at another club — and never offers the active switch, which stays
 * with platform admins (firestore.rules enforces both).
 */
@Component({
  selector: 'app-club-settings',
  standalone: true,
  imports: [NavbarComponent, ClubDetailsFormComponent],
  templateUrl: './club-settings.component.html',
})
export class ClubSettingsComponent {
  private readonly clubContext = inject(ClubContextService);
  private readonly directory = inject(ClubDirectoryService);

  readonly club = computed<ClubRecord | null>(() => {
    const id = this.clubContext.currentClubId();
    const club = this.clubContext.currentClub();
    return id && club ? { id, ...club } : null;
  });
  readonly backPath = computed(() => `/c/${this.clubContext.currentClubSlug()}/admin/hub`);

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  async save(fields: ClubEditableFields): Promise<void> {
    const club = this.club();
    if (!club || this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      // `active` is deliberately dropped: only platform admins may change it.
      await this.directory.updateClubDetails(club.id, club.slug, fields);
      this.saved.set(true);
    } catch (err) {
      console.error('updateClubDetails failed', err);
      this.error.set('Could not save. Please check your connection and try again. If a picture is very large, choose a smaller one.');
    } finally {
      this.saving.set(false);
    }
  }
}
