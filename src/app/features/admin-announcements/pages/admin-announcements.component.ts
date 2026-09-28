import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { SubscriptionService } from '../../club-subscription/services/subscription.service';
import { APP_LOCALE } from '../../../core/utils/locale';

/**
 * Club-admin page (route under `admin`, guarded by clubAdminGuard): compose
 * a club announcement and see who has subscribed. There is no email-sending
 * step yet (see CLAUDE.md's Known Gaps) — posting an announcement makes it a
 * public news item on the club home page immediately; the subscriber count
 * is what a future mail step would notify once it's built. The wording below
 * says exactly that, so nobody assumes an email just went out.
 */
@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './admin-announcements.component.html',
})
export class AdminAnnouncementsComponent {
  private readonly subscription = inject(SubscriptionService);

  readonly announcements = this.subscription.announcements;
  readonly subscriberCount = computed(() => this.subscription.subscribers().size);

  subject = '';
  body = '';
  readonly posting = signal(false);
  readonly posted = signal(false);
  readonly error = signal<string | null>(null);

  async post(): Promise<void> {
    this.error.set(null);
    this.posted.set(false);
    if (!this.subject.trim() || !this.body.trim()) {
      this.error.set('Enter a subject and a message.');
      return;
    }
    this.posting.set(true);
    try {
      await this.subscription.postAnnouncement(this.subject, this.body);
      this.subject = '';
      this.body = '';
      this.posted.set(true);
    } catch (err) {
      console.error('postAnnouncement failed', err);
      this.error.set('Could not post the announcement — please try again.');
    } finally {
      this.posting.set(false);
    }
  }

  dateStr(iso: string): string {
    return new Date(iso).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
