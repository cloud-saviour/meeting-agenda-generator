import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-agendas-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent],
  templateUrl: './admin-agendas-hub.component.html',
})
export class AdminAgendasHubComponent {}
