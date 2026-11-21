import type {
  ICityRepository,
  IDriverDeclarationRepository,
  IRideBookingRepository,
  IRideHouseNumberRepository,
  IRidePlaceRepository,
  IRideSafetyRepository,
  IRideSavedRoutesRepository,
  IRideSeriesRepository,
  IRidesFeedRepository,
  IStreetRepository,
} from '@kc/application';
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
import { definePort, type PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';

const city = definePort<ICityRepository>({
  name: 'city',
  create: (client) => new SupabaseCityRepository(adapterClient<typeof SupabaseCityRepository>(client)),
  methods: {
    listAll: 'member',
  },
});

const driverDeclaration = definePort<IDriverDeclarationRepository>({
  name: 'driverDeclaration',
  create: (client) => new SupabaseDriverDeclarationRepository(adapterClient<typeof SupabaseDriverDeclarationRepository>(client)),
  methods: {
    getMine: 'member',
    accept: 'member',
  },
});

const rideBooking = definePort<IRideBookingRepository>({
  name: 'rideBooking',
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

const rideHouseNumber = definePort<IRideHouseNumberRepository>({
  name: 'rideHouseNumber',
  create: (client) => new SupabaseRideHouseNumberRepository(adapterClient<typeof SupabaseRideHouseNumberRepository>(client)),
  methods: {
    save: 'member',
    get: 'member',
  },
});

const ridePlace = definePort<IRidePlaceRepository>({
  name: 'ridePlace',
  create: (client) => new SupabaseRidePlaceRepository(adapterClient<typeof SupabaseRidePlaceRepository>(client)),
  methods: {
    listPlaces: 'member',
  },
});

const rideSafety = definePort<IRideSafetyRepository>({
  name: 'rideSafety',
  create: (client) => new SupabaseRideSafetyRepository(adapterClient<typeof SupabaseRideSafetyRepository>(client)),
  methods: {
    raiseEmergency: 'member',
  },
});

const rideSavedRoutes = definePort<IRideSavedRoutesRepository>({
  name: 'rideSavedRoutes',
  create: (client) => new SupabaseRideSavedRoutesRepository(adapterClient<typeof SupabaseRideSavedRoutesRepository>(client)),
  methods: {
    listMine: 'member',
    save: 'member',
    remove: 'member',
  },
});

const rideSeries = definePort<IRideSeriesRepository>({
  name: 'rideSeries',
  create: (client) => new SupabaseRideSeriesRepository(adapterClient<typeof SupabaseRideSeriesRepository>(client)),
  methods: {
    listMine: 'member',
    create: 'member',
    setStatus: 'member',
    updateSchedule: 'member',
    listOccurrences: 'member',
  },
});

const ridesFeed = definePort<IRidesFeedRepository>({
  name: 'ridesFeed',
  create: (client) => new SupabaseRidesFeedRepository(adapterClient<typeof SupabaseRidesFeedRepository>(client)),
  methods: {
    list: 'member',
  },
});

const street = definePort<IStreetRepository>({
  name: 'street',
  create: (client) => new SupabaseStreetRepository(adapterClient<typeof SupabaseStreetRepository>(client)),
  methods: {
    listByCity: 'member',
  },
});

export const RIDES_PORTS: readonly PortDefinition[] = [city, driverDeclaration, rideBooking, rideHouseNumber, ridePlace, rideSafety, rideSavedRoutes, rideSeries, ridesFeed, street];
