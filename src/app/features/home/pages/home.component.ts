import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly publishedAgenda = inject(PublishedAgendaService);
  private readonly auth = inject(AuthService);

  /** The meeting the "Meeting Check-in" tile links to — nearest upcoming published meeting, or the most recent past one. Null if nothing's ever been published. */
  readonly nextMeeting = this.publishedAgenda.nearestEntry;

  /** Gates the admin tiles (Manage Agendas / Manage Roles) vs. everyone else's first tile. */
  readonly isAdmin = this.auth.isAdmin;

  /** A signed-in non-admin member gets a "Member Profile" tile instead of "Sign In" — isAdmin() is checked first in the template, so this only ever matters for the non-admin case. */
  readonly isSignedIn = computed(() => this.auth.currentUser() !== null);

  /**
   * Drives the grid's column count. The first slot is always exactly one of
   * Manage Agendas+Manage Roles (admin, counts as 2) or Member Profile/Sign
   * In (everyone else, counts as 1); Meeting Check-in only counts when a
   * meeting is currently published (nextMeeting() non-null — the tile is
   * omitted entirely otherwise, not shown-disabled, since it's the app's
   * only anonymous/visitor-facing check-in entry point and there's nothing
   * for a visitor to check into if nothing's published); Sign Out only
   * counts when signed in. Can be as low as 1 (anonymous, nothing
   * published — just "Sign In"), which the template's `row-cols-1` default
   * handles column-wise, but that lone tile still needs the narrower
   * `[style.max-width.px]` binding in the template or it stretches to the
   * full multi-tile container width.
   */
  readonly tileCount = computed(
    () => (this.isAdmin() ? 2 : 1) + (this.nextMeeting() ? 1 : 0) + (this.isSignedIn() ? 1 : 0)
  );

  signOut(): void {
    this.auth.signOut();
  }
}
