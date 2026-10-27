import { describe, it, expect } from 'vitest';
import { getLocationTimeInfo, formatTimeInZone } from './country-time';

describe('country-time', () => {
  it('correctly resolves India coordinates to India and Asia/Kolkata timezone', () => {
    const info = getLocationTimeInfo(28.6139, 77.2090);
    expect(info.country).toBe('India');
    expect(info.countryCode).toBe('IN');
    expect(info.flag).toBe('🇮🇳');
    expect(info.timeZone).toBe('Asia/Kolkata');

    const formatted = formatTimeInZone(info.timeZone);
    expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('correctly resolves Japan coordinates to Japan and Asia/Tokyo timezone', () => {
    const info = getLocationTimeInfo(35.6762, 139.6503);
    expect(info.country).toBe('Japan');
    expect(info.countryCode).toBe('JP');
    expect(info.flag).toBe('🇯🇵');
    expect(info.timeZone).toBe('Asia/Tokyo');
  });

  it('correctly resolves US coordinates to United States and America/New_York timezone', () => {
    const info = getLocationTimeInfo(40.7128, -74.0060);
    expect(info.country).toContain('United States');
    expect(info.countryCode).toBe('US');
    expect(info.flag).toBe('🇺🇸');
    expect(info.timeZone).toBe('America/New_York');
  });

  it('handles ocean coordinates gracefully', () => {
    const info = getLocationTimeInfo(0, -140);
    expect(info.countryCode).toBeNull();
    expect(info.timeZone).toBeDefined();
  });
});
