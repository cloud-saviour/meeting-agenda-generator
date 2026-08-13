import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgendaStateService } from '../../services/agenda-state.service';

@Component({
  selector: 'app-meeting-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './meeting-form.component.html',
})
export class MeetingFormComponent {
  readonly state = inject(AgendaStateService);

  get m() { return this.state.meeting(); }

  update(field: string, value: string) {
    this.state.updateMeeting({ [field]: value } as any);
  }

  onLogoChange(side: 'left' | 'right', event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => this.state.setLogo(side, e.target!.result as string);
    reader.readAsDataURL(file);
    (event.target as HTMLInputElement).value = '';
  }

  resetLogo(side: 'left' | 'right') { this.state.resetLogo(side); }
}
