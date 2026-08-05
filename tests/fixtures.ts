export function makePricingData() {
  return {
    vehicles: [
      {
        id: 'minibus',
        name: 'Executive Minibus',
        capacity: 16,
        ratePerKm: 1.2,
        commercialWeight: 1,
        fleetCount: 3,
        utilisationDays: 365,
        annualCosts: [{ id: 1, label: 'Fixed costs', cost: 3650 }],
        fuelKpl: 10,
        tyreCostPerKm: 0.1,
        maintenanceCostPerKm: 0.2
      },
      {
        id: 'coach',
        name: 'Premium Coach',
        capacity: 50,
        ratePerKm: 2.6,
        commercialWeight: 1.12,
        fleetCount: 1,
        utilisationDays: 365,
        annualCosts: [{ id: 1, label: 'Fixed costs', cost: 7300 }],
        fuelKpl: 5,
        tyreCostPerKm: 0.2,
        maintenanceCostPerKm: 0.3
      }
    ],
    routeTemplates: [],
    pricingMatrix: [],
    seasonalPricing: [],
    vehicleAvailability: [],
    blockedDates: [],
    annualOverheads: [],
    globalVars: {
      fuelPricePerLitre: 1.5,
      driverWageWeekday: 15,
      driverWageWeekend: 20,
      driverWageHoliday: 22,
      holidayPayPct: 10,
      marginWeekday: 20,
      marginWeekend: 25,
      marginHoliday: 30,
      overnightCost: 80,
      waitingChargePerHour: 50,
      extraLuggageProfitPct: 5,
      distanceUnit: 'km'
      ,emptyLegThresholdKm: 20
      ,dualDriverThresholdHours: 13
      ,waitingWageFactor: 0.75
      ,customerRangePct: 12
    },
    surcharges: {
      m6Toll: 6.5,
      dartford: 2.5,
      ulez: 12.5,
      birminghamCaz: 9,
      driverOvernightSubsistence: 50
    }
  } as any;
}

export function makePricingInput(overrides: Record<string, unknown> = {}) {
  return {
    liveKm: 100,
    deadKm: 20,
    liveDurationMinutes: 90,
    totalDurationMinutes: 120,
    vehicleId: 'minibus',
    journeyType: 'one-way',
    passengers: 12,
    suitcaseCount: 0,
    handbagCount: 0,
    originName: 'Alpha Terminal',
    destinationName: 'Beta Terminal',
    originCoords: null,
    destinationCoords: null,
    waypoints: null,
    waitingMins: 0,
    departureDate: '2026-08-03T12:00:00.000Z',
    usesM6Toll: false,
    ...overrides
  } as any;
}
