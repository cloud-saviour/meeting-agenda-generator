import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-roles-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent],
  templateUrl: './admin-roles-hub.component.html',
})
export class AdminRolesHubComponent {}
