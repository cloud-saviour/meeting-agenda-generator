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

  /** Gates the admin tiles (Manage Agendas / Manage Roles / Manage Admins) vs. everyone else's first tile — full parity for a Firestore-granted admin, not just the real claim. See AuthService. */
  readonly isAppAdmin = this.auth.isAppAdmin;

  /** True-claim only — gates the "Audit Log" tile specifically, since who-granted-what should only be visible to the one tier that can't itself be granted by someone else (see super-admin.guard.ts). */
  readonly isAdmin = this.auth.isAdmin;

  /** A signed-in non-admin member gets a "Member Profile" tile instead of "Sign In" — isAppAdmin() is checked first in the template, so this only ever matters for the non-admin case. */
  readonly isSignedIn = computed(() => this.auth.currentUser() !== null);

  /** Home has no navbar (see CLAUDE.md), so it's the one page that needs its own "who am I signed in as" line rather than relying on NavbarComponent's. */
  readonly currentUser = this.auth.currentUser;

  signOut(): void {
    this.auth.signOut();
  }
}
