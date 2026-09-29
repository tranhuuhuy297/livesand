// Attribution for the AWS Terrain Tiles (Mapzen/Tilezen joerd). Required wording per
// https://github.com/tilezen/joerd/blob/master/docs/attribution.md ("hosted service" variant, which credits Mapzen).

const MAPZEN = 'Terrain Tiles by Mapzen via the AWS Registry of Open Data';
const USGS_GLOBAL = 'United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey';
const NOAA_ETOPO1 = 'Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration';

/** Full required attribution; used when the contributing sources are unknown (live tiles can come from anywhere). */
export const TERRAIN_ATTRIBUTION = [
  MAPZEN,
  'ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736',
  'Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017',
  'Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich',
  'Canada terrain data contains information licensed under the Open Government Licence – Canada',
  'Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers',
  NOAA_ETOPO1,
  'Mexico terrain data source: INEGI, Continental relief, 2016',
  'New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved)',
  'Norway terrain data © Kartverket',
  'United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved',
  USGS_GLOBAL,
].join('; ') + '.';

/** Bit flags for the source datasets named in a tile's X-Imagery-Sources header ("srtm/N21E107.tif", ...). */
export const TERRAIN_SOURCE_FLAGS = { srtm: 1, gmted: 2, etopo1: 4, usgs3dep: 8, other: 0x8000 } as const;

export function sourceFlagForImagery(entry: string): number {
  const dataset = entry.trim().split('/')[0].toLowerCase();
  if (!dataset) return 0;
  if (dataset === 'srtm') return TERRAIN_SOURCE_FLAGS.srtm;
  if (dataset === 'gmted') return TERRAIN_SOURCE_FLAGS.gmted;
  if (dataset === 'etopo1') return TERRAIN_SOURCE_FLAGS.etopo1;
  if (dataset.startsWith('ned') || dataset.startsWith('3dep')) return TERRAIN_SOURCE_FLAGS.usgs3dep;
  return TERRAIN_SOURCE_FLAGS.other;
}

/** Folds a comma-separated X-Imagery-Sources header value into source flags. */
export function sourceFlagsFromImageryHeader(header: string | null | undefined): number {
  return (header ?? '').split(',').reduce((flags, entry) => flags | sourceFlagForImagery(entry), 0);
}

/** Only the credits the contributing sources require; unknown or regional sources fall back to the full text. */
export function attributionForSourceFlags(flags: number): string {
  const F = TERRAIN_SOURCE_FLAGS;
  if (flags === 0 || flags & F.other) return TERRAIN_ATTRIBUTION;
  const usgs: string[] = [];
  if (flags & F.usgs3dep) usgs.push('United States 3DEP (formerly NED)');
  if (flags & F.gmted) usgs.push('global GMTED2010');
  if (flags & F.srtm) usgs.push('SRTM');
  const parts = [MAPZEN];
  if (usgs.length > 0) parts.push(`${usgs.join(' and ')} terrain data courtesy of the U.S. Geological Survey`);
  if (flags & F.etopo1) parts.push(NOAA_ETOPO1);
  return parts.join('; ') + '.';
}
