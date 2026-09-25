import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-admin-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent],
  templateUrl: './admin-hub.component.html',
})
export class AdminHubComponent {
  private readonly auth = inject(AuthService);

  /** True-claim only — gates the Audit Log tile here the same way its own
   *  route gates it (superAdminGuard): a Firestore-granted admin can reach
   *  every other tile on this hub, but not this one. */
  readonly isAdmin = this.auth.isAdmin;
}
