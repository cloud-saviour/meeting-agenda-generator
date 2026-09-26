import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubDirectoryService, ClubRecord } from '../../../core/club/club-directory.service';

/** Platform-admin-only list of every club, with links to open or edit each one (route guarded by superAdminGuard). */
@Component({
  selector: 'app-club-list',
  standalone: true,
  imports: [RouterLink, NavbarComponent],
  templateUrl: './club-list.component.html',
})
export class ClubListComponent implements OnInit {
  private readonly directory = inject(ClubDirectoryService);

  readonly clubs = signal<ClubRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.clubs.set(await this.directory.listClubs());
    } catch (err) {
      console.error('listClubs failed', err);
      this.error.set('Could not load the clubs — try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }
}
