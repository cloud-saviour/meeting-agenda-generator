import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly publishedAgenda = inject(PublishedAgendaService);

  /** The meeting the "Meeting Check-in" tile links to — nearest upcoming published meeting, or the most recent past one. Null if nothing's ever been published. */
  readonly nextMeeting = this.publishedAgenda.nearestEntry;
}
