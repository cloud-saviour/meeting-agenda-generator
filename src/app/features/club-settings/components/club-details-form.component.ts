import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClubEditableFields, ClubRecord } from '../../../core/club/club-directory.service';

/** Logos are stored inline as data URLs on the club record; warn well below Firestore's 1MB document limit. */
const LOGO_WARN_BYTES = 500 * 1024;
/** Mirrors firestore.rules, which rejects a logo string of 700000 characters or more. */
const LOGO_MAX_CHARS = 700000;

export type LogoSide = 'left' | 'right';

/**
 * The club's name, details and logos, shared by the club admin's own settings
 * page and the platform admin's edit page. The parent does the saving; this
 * form only collects values. `showActive` is true only for platform admins —
 * firestore.rules would reject a club admin touching `active` anyway.
 */
@Component({
  selector: 'app-club-details-form',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './club-details-form.component.html',
})
export class ClubDetailsFormComponent {
  readonly club = input.required<ClubRecord>();
  readonly showActive = input(false);
  readonly saving = input(false);
  readonly saved = input(false);
  readonly error = input<string | null>(null);
  readonly backPath = input.required<string>();
  readonly submitted = output<ClubEditableFields>();

  readonly sides: readonly LogoSide[] = ['left', 'right'];

  readonly name = signal('');
  readonly subLine = signal('');
  readonly addressLine = signal('');
  readonly missionStatement = signal('');
  readonly website = signal('');
  readonly facebookPage = signal('');
  readonly logoLeft = signal('');
  readonly logoRight = signal('');
  readonly active = signal(true);
  readonly logoMessage = signal<Record<LogoSide, string | null>>({ left: null, right: null });

  readonly canSave = computed(() => this.name().trim().length > 0 && !this.saving());

  constructor() {
    effect(() => this.load(this.club()));
  }

  private load(club: ClubRecord): void {
    this.name.set(club.name);
    this.subLine.set(club.subLine);
    this.addressLine.set(club.addressLine);
    this.missionStatement.set(club.missionStatement);
    this.website.set(club.website);
    this.facebookPage.set(club.facebookPage);
    this.logoLeft.set(club.logoLeft);
    this.logoRight.set(club.logoRight);
    this.active.set(club.active);
  }

  logo(side: LogoSide): string {
    return side === 'left' ? this.logoLeft() : this.logoRight();
  }

  onLogoChange(side: LogoSide, event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrl.length >= LOGO_MAX_CHARS) {
        this.setMessage(side, 'This picture is too large to save. Please choose a smaller one (under about 500 KB).');
        return;
      }
      (side === 'left' ? this.logoLeft : this.logoRight).set(dataUrl);
      this.setMessage(
        side,
        file.size > LOGO_WARN_BYTES ? `This picture is ${(file.size / 1024).toFixed(0)} KB. A smaller one loads faster.` : null,
      );
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  }

  /** Goes back to the logo that is currently saved on the club. */
  undoLogo(side: LogoSide): void {
    const club = this.club();
    (side === 'left' ? this.logoLeft : this.logoRight).set(side === 'left' ? club.logoLeft : club.logoRight);
    this.setMessage(side, null);
  }

  private setMessage(side: LogoSide, message: string | null): void {
    this.logoMessage.update((m) => ({ ...m, [side]: message }));
  }

  submit(): void {
    if (!this.canSave()) return;
    this.submitted.emit({
      name: this.name(),
      subLine: this.subLine(),
      addressLine: this.addressLine(),
      missionStatement: this.missionStatement(),
      website: this.website(),
      facebookPage: this.facebookPage(),
      logoLeft: this.logoLeft(),
      logoRight: this.logoRight(),
      active: this.active(),
    });
  }
}
