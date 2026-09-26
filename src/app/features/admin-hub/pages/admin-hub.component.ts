import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubLinkPipe } from '../../../core/club/club-link.pipe';
import { AuthService } from '../../../core/auth/auth.service';
import { MembershipService } from '../../membership/services/membership.service';

@Component({
  selector: 'app-admin-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent, ClubLinkPipe],
  templateUrl: './admin-hub.component.html',
})
export class AdminHubComponent {
  private readonly auth = inject(AuthService);
  private readonly membership = inject(MembershipService);

  /** Pending join requests, shown as a badge on the Members tile. */
  readonly pendingCount = signal(0);

  constructor() {
    this.membership
      .countPending()
      .then((n) => this.pendingCount.set(n))
      .catch((err) => console.error('countPending failed', err));
  }

  /** True-claim only — gates the Audit Log tile here the same way its own
   *  route gates it (superAdminGuard): a Firestore-granted admin can reach
   *  every other tile on this hub, but not this one. */
  readonly isAdmin = this.auth.isAdmin;
}
