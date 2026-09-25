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

  /** Computed once per component lifetime — a session-spanning-midnight edge case isn't worth re-deriving on every change detection. */
  readonly todayStr = new Date().toISOString().slice(0, 10);
  dateError: string | null = null;

  get m() { return this.state.meeting(); }

  update(field: string, value: string) {
    this.state.updateMeeting({ [field]: value } as any);
  }

  /**
   * Only gates the interactive date field, not AgendaStateService.updateMeeting()
   * itself — reopening a saved/imported agenda with a genuine past date (an old
   * meeting) must keep working; this only stops setting a NEW past date by hand.
   */
  updateDate(value: string) {
    if (value && value < this.todayStr) {
      this.dateError = 'Meeting date can\'t be in the past.';
      return;
    }
    this.dateError = null;
    this.state.updateMeeting({ date: value });
  }

  /**
   * A logo is stored inline as a base64 data URL inside the saved/published
   * agenda document (see AgendaSnapshot.logoLeft/logoRight) — not in
   * separate file storage — so its bytes count directly against Firestore's
   * 1MB-per-document limit, shared with the rest of that agenda. Base64
   * inflates raw bytes by ~33%, so this warns well below 1MB to leave room
   * for everything else on the document. Non-blocking — just a heads-up,
   * the upload still proceeds.
   */
  private readonly LOGO_WARN_BYTES = 500 * 1024;
  logoWarning: Record<'left' | 'right', string | null> = { left: null, right: null };

  onLogoChange(side: 'left' | 'right', event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.logoWarning[side] =
      file.size > this.LOGO_WARN_BYTES
        ? `This image is ${(file.size / 1024).toFixed(0)} KB — large logos are stored directly in the agenda and count toward Firestore's 1MB document size limit. Consider a smaller image.`
        : null;

    const reader = new FileReader();
    reader.onload = e => this.state.setLogo(side, e.target!.result as string);
    reader.readAsDataURL(file);
    (event.target as HTMLInputElement).value = '';
  }

  resetLogo(side: 'left' | 'right') {
    this.state.resetLogo(side);
    this.logoWarning[side] = null;
  }
}
