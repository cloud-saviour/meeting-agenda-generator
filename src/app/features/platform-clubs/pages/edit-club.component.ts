import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubDirectoryService, ClubRecord } from '../../../core/club/club-directory.service';

/**
 * Platform-admin-only edit form for one club (route guarded by
 * superAdminGuard; firestore.rules enforces it server-side and keeps `slug`
 * and `createdAt` immutable). Already-saved agendas keep the club text they
 * were saved with — only new agendas and the live club header pick up edits.
 */
@Component({
  selector: 'app-edit-club',
  standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent],
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

  readonly name = signal('');
  readonly subLine = signal('');
  readonly addressLine = signal('');
  readonly missionStatement = signal('');
  readonly website = signal('');
  readonly facebookPage = signal('');
  readonly active = signal(true);

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    try {
      const club = await this.directory.getClubBySlug(slug);
      if (!club) {
        this.notFound.set(true);
        return;
      }
      this.club.set(club);
      this.name.set(club.name);
      this.subLine.set(club.subLine);
      this.addressLine.set(club.addressLine);
      this.missionStatement.set(club.missionStatement);
      this.website.set(club.website);
      this.facebookPage.set(club.facebookPage);
      this.active.set(club.active);
    } catch (err) {
      console.error('getClubBySlug failed', err);
      this.error.set('Could not load this club — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    const club = this.club();
    if (!club || !this.name().trim() || this.saving()) return;
    if (club.active && !this.active() && !confirm(`Deactivate "${club.name}"? Members and guests will no longer be able to open it. Its data is kept, and you can reactivate it any time.`)) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      await this.directory.updateClub(club.id, club.slug, {
        name: this.name(),
        subLine: this.subLine(),
        addressLine: this.addressLine(),
        missionStatement: this.missionStatement(),
        website: this.website(),
        facebookPage: this.facebookPage(),
        active: this.active(),
      }, club.active);
      this.club.set({ ...club, active: this.active() });
      this.saved.set(true);
    } catch (err) {
      console.error('updateClub failed', err);
      this.error.set('Could not save the club. Only platform admins can edit clubs — check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
