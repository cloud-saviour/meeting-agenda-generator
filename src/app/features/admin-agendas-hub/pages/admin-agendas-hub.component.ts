import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgendaStateService } from '../../agenda-editor/services/agenda-state.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-agendas-hub',
  standalone: true,
  imports: [RouterLink, NavbarComponent],
  templateUrl: './admin-agendas-hub.component.html',
})
export class AdminAgendasHubComponent {
  readonly state = inject(AgendaStateService);
}
