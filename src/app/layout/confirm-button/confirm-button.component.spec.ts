import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ConfirmButtonComponent } from './confirm-button.component';

function setup() {
  const fixture = TestBed.configureTestingModule({ imports: [ConfirmButtonComponent] }).createComponent(ConfirmButtonComponent);
  fixture.componentRef.setInput('label', 'Give up role');
  fixture.componentRef.setInput('question', 'Give up this role?');
  fixture.componentRef.setInput('yesLabel', 'Yes, give it up');
  let confirmed = 0;
  fixture.componentInstance.confirmed.subscribe(() => confirmed++);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = () => [...el.querySelectorAll('button')].map((b) => b.textContent!.trim());
  const click = (text: string) => {
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text)!.click();
    fixture.detectChanges();
  };
  return { el, buttons, click, count: () => confirmed };
}

describe('ConfirmButtonComponent', () => {
  it('shows only the action button until it is tapped, and does nothing yet', () => {
    const { buttons, count } = setup();
    expect(buttons()).toEqual(['Give up role']);
    expect(count()).toBe(0);
  });

  it('asks first, and only "Yes" confirms', () => {
    const { el, buttons, click, count } = setup();
    click('Give up role');
    expect(el.textContent).toContain('Give up this role?');
    expect(buttons()).toEqual(['Yes, give it up', 'No, keep it']);
    expect(count()).toBe(0);

    click('Yes, give it up');
    expect(count()).toBe(1);
    expect(buttons()).toEqual(['Give up role']);
  });

  it('"No" backs out without confirming', () => {
    const { buttons, click, count } = setup();
    click('Give up role');
    click('No, keep it');
    expect(count()).toBe(0);
    expect(buttons()).toEqual(['Give up role']);
  });
});
