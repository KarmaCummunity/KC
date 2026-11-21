import {
  SupabaseCityRepository,
  SupabaseDriverDeclarationRepository,
  SupabaseRideBookingRepository,
  SupabaseRideHouseNumberRepository,
  SupabaseRidePlaceRepository,
  SupabaseRideSafetyRepository,
  SupabaseRideSavedRoutesRepository,
  SupabaseRideSeriesRepository,
  SupabaseRidesFeedRepository,
  SupabaseStreetRepository,
} from '@kc/infrastructure-supabase';
import type { PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';
import { hostedPort } from '../hostedPort';

const city = hostedPort('city', {
  create: (client) => new SupabaseCityRepository(adapterClient<typeof SupabaseCityRepository>(client)),
  methods: {
    listAll: 'member',
  },
});

const driverDeclaration = hostedPort('driverDeclaration', {
  create: (client) => new SupabaseDriverDeclarationRepository(adapterClient<typeof SupabaseDriverDeclarationRepository>(client)),
  methods: {
    getMine: 'member',
    accept: 'member',
  },
});

const rideBooking = hostedPort('rideBooking', {
  create: (client) => new SupabaseRideBookingRepository(adapterClient<typeof SupabaseRideBookingRepository>(client)),
  methods: {
    bookSeat: 'member',
    listForRide: 'member',
    approve: 'member',
    decline: 'member',
    cancel: 'member',
    complete: 'member',
    completeRide: 'member',
    reinstate: 'member',
  },
});

const rideHouseNumber = hostedPort('rideHouseNumber', {
  create: (client) => new SupabaseRideHouseNumberRepository(adapterClient<typeof SupabaseRideHouseNumberRepository>(client)),
  methods: {
    save: 'member',
    get: 'member',
  },
});

const ridePlace = hostedPort('ridePlace', {
  create: (client) => new SupabaseRidePlaceRepository(adapterClient<typeof SupabaseRidePlaceRepository>(client)),
  methods: {
    listPlaces: 'member',
  },
});

const rideSafety = hostedPort('rideSafety', {
  create: (client) => new SupabaseRideSafetyRepository(adapterClient<typeof SupabaseRideSafetyRepository>(client)),
  methods: {
    raiseEmergency: 'member',
  },
});

const rideSavedRoutes = hostedPort('rideSavedRoutes', {
  create: (client) => new SupabaseRideSavedRoutesRepository(adapterClient<typeof SupabaseRideSavedRoutesRepository>(client)),
  methods: {
    listMine: 'member',
    save: 'member',
    remove: 'member',
  },
});

const rideSeries = hostedPort('rideSeries', {
  create: (client) => new SupabaseRideSeriesRepository(adapterClient<typeof SupabaseRideSeriesRepository>(client)),
  methods: {
    listMine: 'member',
    create: 'member',
    setStatus: 'member',
    updateSchedule: 'member',
    listOccurrences: 'member',
  },
});

const ridesFeed = hostedPort('ridesFeed', {
  create: (client) => new SupabaseRidesFeedRepository(adapterClient<typeof SupabaseRidesFeedRepository>(client)),
  methods: {
    list: 'member',
  },
});

const street = hostedPort('street', {
  create: (client) => new SupabaseStreetRepository(adapterClient<typeof SupabaseStreetRepository>(client)),
  methods: {
    listByCity: 'member',
  },
});

export const RIDES_PORTS: readonly PortDefinition[] = [city, driverDeclaration, rideBooking, rideHouseNumber, ridePlace, rideSafety, rideSavedRoutes, rideSeries, ridesFeed, street];
