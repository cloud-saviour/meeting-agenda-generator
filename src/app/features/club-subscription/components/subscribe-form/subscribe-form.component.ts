import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SubscriptionService } from '../../services/subscription.service';

/**
 * The one place in the app a guest — no sign-in, no membership — can give
 * their email to a club. Shown on the club home page. "Unsubscribe" is a
 * second, plain form asking for the email again rather than a token/link,
 * since subscribing itself needed no verification either — see
 * SubscriptionService's class doc.
 */
@Component({
  selector: 'app-subscribe-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './subscribe-form.component.html',
})
export class SubscribeFormComponent {
  private readonly subscription = inject(SubscriptionService);

  mode: 'subscribe' | 'unsubscribe' = 'subscribe';
  email = '';
  busy = signal(false);
  notice = signal<string | null>(null);
  error = signal<string | null>(null);

  showUnsubscribe(): void {
    this.mode = 'unsubscribe';
    this.notice.set(null);
    this.error.set(null);
  }

  showSubscribe(): void {
    this.mode = 'subscribe';
    this.notice.set(null);
    this.error.set(null);
  }

  async subscribe(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    if (!this.email.trim()) {
      this.error.set('Enter your email address.');
      return;
    }
    this.busy.set(true);
    try {
      const ok = await this.subscription.subscribe(this.email);
      if (!ok) {
        this.error.set('Enter a valid email address.');
        return;
      }
      this.notice.set(`Subscribed! You'll hear from this club at ${this.email.trim()}.`);
      this.email = '';
    } catch (err) {
      console.error('subscribe failed', err);
      this.error.set('Could not subscribe — please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async unsubscribe(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    if (!this.email.trim()) {
      this.error.set('Enter the email address you subscribed with.');
      return;
    }
    this.busy.set(true);
    try {
      const ok = await this.subscription.unsubscribe(this.email);
      if (!ok) {
        this.error.set('Enter a valid email address.');
        return;
      }
      this.notice.set('You will not hear from this club by email again.');
      this.email = '';
    } catch (err) {
      console.error('unsubscribe failed', err);
      this.error.set('Could not unsubscribe — please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
