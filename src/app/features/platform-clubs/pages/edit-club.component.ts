import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClubDetailsFormComponent } from '../../club-settings/components/club-details-form.component';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubDirectoryService, ClubEditableFields, ClubRecord } from '../../../core/club/club-directory.service';

/**
 * Platform-admin-only edit form for one club (route guarded by
 * superAdminGuard; firestore.rules enforces it server-side and keeps `slug`
 * and `createdAt` immutable). Already-saved agendas keep the club text they
 * were saved with — only new agendas and the live club header pick up edits.
 */
@Component({
  selector: 'app-edit-club',
  standalone: true,
  imports: [RouterLink, NavbarComponent, ClubDetailsFormComponent],
  templateUrl: './edit-club.component.html',
})
export class EditClubComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly directory = inject(ClubDirectoryService);

  readonly club = signal<ClubRecord | null>(null);
  readonly notFound = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    try {
      const club = await this.directory.getClubBySlug(slug);
      if (!club) {
        this.notFound.set(true);
        return;
      }
      this.club.set(club);
    } catch (err) {
      console.error('getClubBySlug failed', err);
      this.error.set('Could not load this club — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(fields: ClubEditableFields): Promise<void> {
    const club = this.club();
    if (!club || this.saving()) return;
    if (club.active && !fields.active && !confirm(`Deactivate "${club.name}"? Members and guests will no longer be able to open it. Its data is kept, and you can reactivate it any time.`)) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      await this.directory.updateClub(club.id, club.slug, fields, club.active);
      this.club.set({ ...club, ...fields, name: fields.name.trim() });
      this.saved.set(true);
    } catch (err) {
      console.error('updateClub failed', err);
      this.error.set('Could not save the club. Only platform admins can edit clubs — check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
