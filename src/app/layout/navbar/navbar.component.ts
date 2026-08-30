import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  @Input() title = '';
  @Input() links: { label: string; path: string; queryParams?: Record<string, string> }[] = [];
  /** checkin/admin-roles use position:fixed; agenda-editor's flex shell doesn't. */
  @Input() fixed = false;
  /** agenda-editor only, for its existing d-print-none behavior. */
  @Input() printHidden = false;
}
