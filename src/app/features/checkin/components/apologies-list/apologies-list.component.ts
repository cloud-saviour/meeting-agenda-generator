import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';
import { ClubContextService } from '../../../../core/club/club-context.service';

/**
 * Admin-only display of check-in's `apologies` list — there was previously
 * no render surface for it anywhere in the app. Gated entirely behind
 * `club.isAppAdmin()` in the template: apologies were never shown to
 * anyone before this, and this component exists purely so an admin can
 * correct a bogus/duplicate apology entry (see
 * CheckinStateService.adminRemoveApology()), not as a new public display.
 */
@Component({
  selector: 'app-apologies-list',
  standalone: true,
  templateUrl: './apologies-list.component.html',
})
export class ApologiesListComponent {
  readonly state = inject(CheckinStateService);
  readonly club = inject(ClubContextService);

  removeError: string | null = null;
  private readonly pendingRemove = new Set<string>();

  get apologies() {
    return this.state.apologies();
  }

  isRemovePending(uid: string): boolean {
    return this.pendingRemove.has(uid);
  }

  async remove(uid: string, name: string) {
    const confirmed = confirm(`Remove the apology entry for "${name}"? Use this only for a bogus/duplicate entry.`);
    if (!confirmed) return;
    this.removeError = null;
    this.pendingRemove.add(uid);
    try {
      await this.state.adminRemoveApology(uid);
    } catch {
      this.removeError = 'Could not remove — try again.';
    } finally {
      this.pendingRemove.delete(uid);
    }
  }
}
