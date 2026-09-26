import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ClubDirectoryService, ClubRecord } from '../../../core/club/club-directory.service';
import { MembershipService } from '../../membership/services/membership.service';

/**
 * The bare `/` for members and guests: pick which club to open. Only active
 * clubs are listed. With exactly one active club there is nothing to choose,
 * so it goes straight in (replacing this page in history, so Back doesn't
 * bounce). Platform admins never see this — rootRedirectGuard sends them to
 * the clubs list.
 */
@Component({
  selector: 'app-club-picker',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './club-picker.component.html',
})
export class ClubPickerComponent implements OnInit {
  private readonly directory = inject(ClubDirectoryService);
  private readonly router = inject(Router);
  private readonly membership = inject(MembershipService);

  /** Clubs the signed-in person is an approved member of, listed first. */
  readonly myClubs = signal<ClubRecord[]>([]);
  /** Every other active club. */
  readonly clubs = signal<ClubRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const clubs = await this.directory.listActiveClubs();
      if (clubs.length === 1) {
        await this.router.navigate(['/c', clubs[0].slug], { replaceUrl: true });
        return;
      }
      let mine: ClubRecord[] = [];
      try {
        mine = (await this.membership.listMyClubs()).filter((m) => m.status === 'active').map((m) => m.club);
      } catch (err) {
        console.error('listMyClubs failed', err);
      }
      const mineIds = new Set(mine.map((c) => c.id));
      this.myClubs.set(mine.filter((c) => clubs.some((a) => a.id === c.id)));
      this.clubs.set(clubs.filter((c) => !mineIds.has(c.id)));
    } catch (err) {
      console.error('listActiveClubs failed', err);
      this.error.set('Could not load the clubs — check your connection and reload the page.');
    } finally {
      this.loading.set(false);
    }
  }
}
