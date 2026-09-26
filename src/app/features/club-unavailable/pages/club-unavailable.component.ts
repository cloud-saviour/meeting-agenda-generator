import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Shown to members and guests who open a deactivated club. See ClubContextService.unavailable. */
@Component({
  selector: 'app-club-unavailable',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="d-flex flex-column align-items-center justify-content-center vh-100 bg-body-secondary px-3">
      <div class="card text-center p-4 shadow-sm" style="max-width:420px;">
        <img src="logo.png" alt="Agora" height="60" class="mb-3 align-self-center">
        <h1 class="fs-5 fw-bold">This club isn't available right now</h1>
        <p class="text-muted small">It has been switched off by an administrator. Please contact the club's organisers.</p>
        <a routerLink="/login" class="btn btn-outline-secondary btn-sm align-self-center">Administrator sign in</a>
      </div>
    </div>
  `,
})
export class ClubUnavailableComponent {}
