import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
  });

  it('returns the value that was set for a key', () => {
    service.set('foo', 'bar');
    expect(service.get('foo')).toBe('bar');
  });

  it('returns null for a key that was never set', () => {
    expect(service.get('missing')).toBeNull();
  });

  it('remove deletes a stored value', () => {
    service.set('foo', 'bar');
    service.remove('foo');
    expect(service.get('foo')).toBeNull();
  });
});
