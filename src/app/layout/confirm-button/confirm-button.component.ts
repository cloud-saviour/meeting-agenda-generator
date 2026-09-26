import { Component, input, output, signal } from '@angular/core';

/**
 * A two-step button for actions that give something up: the first tap shows a
 * short question with "Yes" and "No" buttons, and only "Yes" emits `confirmed`.
 * Replaces the browser's `confirm()` popup, which is easy to dismiss by
 * accident and unreadable on a phone. Both answers are full-size buttons.
 */
@Component({
  selector: 'app-confirm-button',
  standalone: true,
  template: `
    @if (!asking()) {
      <button type="button" [class]="buttonClass()" [disabled]="disabled()" (click)="asking.set(true)">{{ label() }}</button>
    } @else {
      <span class="d-inline-flex flex-wrap align-items-center gap-2" role="group" aria-label="Please confirm">
        <span class="fw-semibold">{{ question() }}</span>
        <button type="button" class="btn btn-danger" (click)="answer(true)">{{ yesLabel() }}</button>
        <button type="button" class="btn btn-outline-secondary" (click)="answer(false)">{{ noLabel() }}</button>
      </span>
    }
  `,
})
export class ConfirmButtonComponent {
  readonly label = input.required<string>();
  readonly question = input('Are you sure?');
  readonly yesLabel = input('Yes');
  readonly noLabel = input('No, keep it');
  readonly buttonClass = input('btn btn-outline-secondary');
  readonly disabled = input(false);
  readonly confirmed = output<void>();

  readonly asking = signal(false);

  answer(yes: boolean): void {
    this.asking.set(false);
    if (yes) this.confirmed.emit();
  }
}
