export const NEWS_FEEDS = {
  spaceNews: 'https://spacenews.com/feed/',
  nasaReleases: 'https://www.nasa.gov/news-release/feed/',
  gcaptain: 'https://gcaptain.com/feed/',
  usni: 'https://news.usni.org/feed',
  defenseNews: 'https://www.defensenews.com/arc/outboundfeeds/rss/',
} as const;

export const NEWS_SOURCES = {
  spaceNews: 'https://spacenews.com',
  nasaReleases: 'https://www.nasa.gov/news-release/',
  gcaptain: 'https://gcaptain.com',
  usni: 'https://news.usni.org',
  defenseNews: 'https://www.defensenews.com',
  adsb: 'https://opendata.adsb.fi',
  noaa: 'https://www.swpc.noaa.gov',
  openSky: 'https://opensky-network.org',
  panamaCanals: 'https://pancanal.com',
  nato: 'https://ac.nato.int',
} as const;

export const NEWS_FEED_SOURCES = [
  { key: 'spaceNews', source: 'SpaceNews', category: 'space', sourceUrl: NEWS_SOURCES.spaceNews },
  { key: 'nasaReleases', source: 'NASA', category: 'space', sourceUrl: NEWS_SOURCES.nasaReleases },
  { key: 'gcaptain', source: 'gCaptain', category: 'maritime', sourceUrl: NEWS_SOURCES.gcaptain },
  { key: 'usni', source: 'USNI News', category: 'maritime', sourceUrl: NEWS_SOURCES.usni },
  { key: 'defenseNews', source: 'Defense News', category: 'defense', sourceUrl: NEWS_SOURCES.defenseNews },
] as const;
