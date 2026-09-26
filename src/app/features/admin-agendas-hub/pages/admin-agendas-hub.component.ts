import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { ClubLinkPipe } from '../../../core/club/club-link.pipe';

@Component({
  selector: 'app-admin-agendas-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent, ClubLinkPipe],
  templateUrl: './admin-agendas-hub.component.html',
})
export class AdminAgendasHubComponent {}
