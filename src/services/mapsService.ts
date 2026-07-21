const ORS_API_URL = 'https://api.openrouteservice.org';
const STORE_CATEGORY_IDS = [451, 475, 493, 518];

export interface MapLocation {
  latitude: number;
  longitude: number;
}

export interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  distanceMeters: number;
  location: MapLocation;
  source: 'OPENROUTESERVICE';
}

function getApiKey() {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTESERVICE_API_KEY is not configured');
  }
  return apiKey;
}

function assertLocation(location: MapLocation, fieldName: string) {
  if (
    !Number.isFinite(location?.latitude) ||
    !Number.isFinite(location?.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new Error(`${fieldName} must contain valid latitude and longitude`);
  }
}

async function orsRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ORS_API_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: getApiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    const detail = payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
    throw new Error(`OpenRouteService request failed: ${detail}`);
  }
  return payload as T;
}

export async function getNearbyStores(
  userLocation: MapLocation,
  requestedRadiusMeters = 2000
): Promise<NearbyStore[]> {
  assertLocation(userLocation, 'location');
  const radiusMeters = Math.min(2000, Math.max(100, requestedRadiusMeters));

  const poiPayload = await orsRequest<any>('/pois', {
    request: 'pois',
    geometry: {
      geojson: {
        type: 'Point',
        coordinates: [userLocation.longitude, userLocation.latitude]
      },
      buffer: radiusMeters
    },
    filters: { category_ids: STORE_CATEGORY_IDS },
    sortby: 'distance',
    limit: 10
  });

  const stores: NearbyStore[] = (poiPayload.features ?? []).flatMap((feature: any) => {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];

    const tags = feature.properties?.osm_tags ?? {};
    const name = tags.name ?? tags.brand ?? tags.operator;
    if (!name) return [];

    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city']]
      .filter(Boolean)
      .join(', ');

    return [{
      id: `${feature.properties?.osm_type ?? 'osm'}-${feature.properties?.osm_id ?? coordinates.join('-')}`,
      name,
      address: address || undefined,
      distanceMeters: Math.round(feature.properties?.distance ?? 0),
      location: { longitude: coordinates[0], latitude: coordinates[1] },
      source: 'OPENROUTESERVICE' as const
    }];
  });

  if (stores.length === 0) return [];

  try {
    const matrix = await orsRequest<{ distances?: Array<Array<number | null>> }>(
      '/v2/matrix/driving-car',
      {
        locations: [
          [userLocation.longitude, userLocation.latitude],
          ...stores.map((store) => [store.location.longitude, store.location.latitude])
        ],
        sources: [0],
        destinations: stores.map((_, index) => index + 1),
        metrics: ['distance'],
        units: 'm'
      }
    );

    const distances = matrix.distances?.[0] ?? [];
    stores.forEach((store, index) => {
      const distance = distances[index];
      if (typeof distance === 'number') store.distanceMeters = Math.round(distance);
    });
  } catch (error) {
    // POI distance remains usable if Matrix cannot route to one of the locations.
    console.warn('[maps] ORS Matrix unavailable:', error);
  }

  return stores.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function getDirections(from: MapLocation, to: MapLocation) {
  assertLocation(from, 'from');
  assertLocation(to, 'to');

  return orsRequest('/v2/directions/driving-car/geojson', {
    coordinates: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude]
    ],
    instructions: true,
    language: 'en'
  });
}
