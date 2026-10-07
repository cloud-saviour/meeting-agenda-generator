import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';
import { ClubLinkPipe } from '../../../core/club/club-link.pipe';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { environment } from '../../../../environments/environment';
import { MembershipService } from '../../membership/services/membership.service';
import { SubscribeFormComponent } from '../../club-subscription/components/subscribe-form/subscribe-form.component';
import { SubscriptionService } from '../../club-subscription/services/subscription.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ClubLinkPipe, NavbarComponent, SubscribeFormComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly publishedAgenda = inject(PublishedAgendaService);
  private readonly auth = inject(AuthService);
  private readonly clubContext = inject(ClubContextService);
  readonly membership = inject(MembershipService);
  private readonly subscription = inject(SubscriptionService);

  /** Most recent club announcements, newest first — see SubscriptionService. Public, so this shows for a signed-out guest too. */
  readonly announcements = this.subscription.announcements;

  /** TEMPORARY, same gate as the check-in page's subscribe toggle: club news and email subscription are platform-admin-only while the feature is tested. */
  readonly isPlatformAdmin = this.auth.isAdmin;

  readonly guestCheckinAllowed = environment.allowGuestCheckin;

  readonly clubName = computed(() => this.clubContext.currentClub()?.name ?? '');
  readonly membershipBusy = signal(false);
  readonly membershipError = signal<string | null>(null);

  /** Signed-in, non-admin people get a membership tile once their own membership row has loaded (admins don't need one). */
  readonly showMembershipTile = computed(() => this.isSignedIn() && !this.isAppAdmin() && this.membership.mineLoaded() && this.membership.status() !== 'active');

  /** The meeting the "Meeting Check-in" tile links to — nearest upcoming published meeting, or the most recent past one. Null if nothing's ever been published. */
  readonly nextMeeting = this.publishedAgenda.nearestEntry;

  /** Gates the single "Admin" tile (which itself leads to Agendas / Manage Roles / Manage Admins / Audit Log — see AdminHubComponent) vs. everyone else's first tile — full parity for a Firestore-granted admin of the CURRENT club, not just the real claim. See ClubContextService. */
  readonly isAppAdmin = this.clubContext.isAppAdmin;

  /** A signed-in non-admin member gets a "Member Profile" tile instead of "Sign In" — isAppAdmin() is checked first in the template, so this only ever matters for the non-admin case. */
  readonly isSignedIn = computed(() => this.auth.currentUser() !== null);

  async requestToJoin(): Promise<void> {
    await this.runMembership(() => this.membership.requestToJoin());
  }

  async cancelRequest(): Promise<void> {
    await this.runMembership(() => this.membership.cancelRequest());
  }

  private async runMembership(action: () => Promise<void>): Promise<void> {
    this.membershipBusy.set(true);
    this.membershipError.set(null);
    try {
      await action();
    } catch (err) {
      console.error('membership action failed', err);
      this.membershipError.set('Could not update your membership — please try again.');
    } finally {
      this.membershipBusy.set(false);
    }
  }
}
