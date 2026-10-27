import { describe, it, expect } from 'vitest';
import { parseOrbitalParameters, getSatelliteLaunchIntel, getSatelliteQuickIntel } from './satellite-intel';

describe('satellite-intel', () => {
  it('parses DMSP TLE parameters correctly', () => {
    const l1 = '1 29522U 06048A   26286.51234567  .00000123  00000-0  12345-4 0  9998';
    const l2 = '2 29522  98.8123 123.4567 0012345  45.6789 314.5678 14.12345678123456';
    const params = parseOrbitalParameters(l1, l2);

    expect(params.noradId).toBe('29522');
    expect(params.cosparId).toBe('06048A');
    expect(params.launchYear).toBe('2006');
    expect(params.inclinationDeg).toBeCloseTo(98.81, 1);
    expect(params.apogeeKm).toBeGreaterThan(800);
    expect(params.perigeeKm).toBeGreaterThan(800);
  });

  it('maps DMSP satellite launch intelligence accurately', () => {
    const params = parseOrbitalParameters('1 29522U 06048A', '2 29522');
    const intel = getSatelliteLaunchIntel('DMSP 5D-3 F17', params);

    expect(intel.country).toBe('United States');
    expect(intel.operator).toContain('Space Force');
    expect(intel.rocket).toContain('Delta IV');
    expect(intel.launchSite).toContain('Vandenberg');
  });

  it('maps USA classified reconnaissance satellites accurately', () => {
    const params = parseOrbitalParameters('1 39232U 13043A', '2 39232');
    const intel = getSatelliteLaunchIntel('USA 245', params);

    expect(intel.operator).toContain('National Reconnaissance Office');
    expect(intel.country).toBe('United States');
  });

  it('maps FENGYUN weather satellites to China with flag and Weather type', () => {
    const params = parseOrbitalParameters('1 43491U 18049A', '2 43491');
    const intel = getSatelliteLaunchIntel('FENGYUN 2H', params);

    expect(intel.country).toBe('China');
    expect(intel.flag).toBe('🇨🇳');
    expect(intel.countryCode).toBe('CN');
  });

  it('resolves quick intel with name, country, flag, and type', () => {
    const quick = getSatelliteQuickIntel({
      name: 'FENGYUN 2H',
      mission: 'Weather',
      category: 'earth_obs',
    });

    expect(quick.name).toBe('FENGYUN 2H');
    expect(quick.country).toBe('China');
    expect(quick.flag).toBe('🇨🇳');
    expect(quick.type).toBe('Weather');
  });
});
