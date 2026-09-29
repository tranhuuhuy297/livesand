// Real-world places baked into public/places/ (see scripts/bake-real-places.mjs). Width is chosen so the landmark
// fills the 4:3 sandbox; lat/lon is the frame centre, not necessarily the landmark itself.

export interface RealPlace {
  id: string;
  name: string;
  nameVi?: string;
  country: string;
  blurb: string;
  lat: number;
  lon: number;
  widthKm: number;
  /** Overrides the automatic vertical exaggeration (vertical scale relative to horizontal). */
  verticalExaggeration?: number;
}

export const REAL_PLACES: RealPlace[] = [
  {
    id: 'ha-long-bay',
    name: 'Ha Long Bay',
    nameVi: 'Vịnh Hạ Long',
    country: 'Vietnam',
    blurb: 'Nearly two thousand limestone karst islands rise from a shallow bay. A UNESCO World Heritage site.',
    lat: 20.88,
    lon: 107.1,
    widthKm: 25,
  },
  {
    id: 'hoi-an',
    name: 'Hoi An',
    nameVi: 'Hội An',
    country: 'Vietnam',
    blurb: 'An old trading port where the Thu Bồn river meets the sea. Its ancient town floods almost every rainy season.',
    lat: 15.88,
    lon: 108.35,
    widthKm: 14,
    // Flat deltas would get ~25x automatically: canopy noise turns into hills and rain beads into puddles.
    verticalExaggeration: 9,
  },
  {
    id: 'hue',
    name: 'Hue',
    nameVi: 'Huế',
    country: 'Vietnam',
    blurb: 'The imperial citadel sits on the Perfume River as it winds from the southern hills to the Tam Giang lagoon. The low city floods in storm season.',
    lat: 16.485,
    lon: 107.595,
    widthKm: 16,
    verticalExaggeration: 9,
  },
  {
    id: 'fansipan',
    name: 'Fansipan',
    nameVi: 'Phan Xi Păng',
    country: 'Vietnam',
    blurb: 'The roof of Indochina (3,143 m) in the Hoàng Liên Sơn range above Sa Pa. Steep valleys turn heavy rain into flash floods.',
    lat: 22.31,
    lon: 103.8,
    widthKm: 20,
  },
  {
    id: 'grand-canyon',
    name: 'Grand Canyon',
    country: 'USA',
    blurb: 'The Colorado River has carved a canyon up to 1.8 km deep through layers of ancient rock.',
    lat: 36.1,
    lon: -112.1,
    widthKm: 30,
  },
  {
    id: 'mount-fuji',
    name: 'Mount Fuji',
    country: 'Japan',
    blurb: "Japan's highest peak (3,776 m): a near-perfect volcanic cone ringed by the Fuji Five Lakes.",
    lat: 35.38,
    lon: 138.73,
    widthKm: 40,
  },
  {
    id: 'yosemite',
    name: 'Yosemite Valley',
    country: 'USA',
    blurb: 'A glacier-carved valley walled by El Capitan and Half Dome, with the Merced River winding along its floor.',
    lat: 37.74,
    lon: -119.585,
    widthKm: 15,
  },
  {
    id: 'mount-st-helens',
    name: 'Mount St. Helens',
    country: 'USA',
    blurb: 'Its 1980 eruption blew out the north flank, leaving a horseshoe crater that opens toward Spirit Lake.',
    lat: 46.225,
    lon: -122.18,
    widthKm: 22,
  },
];

export function findRealPlace(id: string): RealPlace | undefined {
  return REAL_PLACES.find((p) => p.id === id);
}
