import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePriceFromData,
  PricingConfigurationError
} from '../src/engines/pricingEngine';
import { makePricingData, makePricingInput } from './fixtures';

test('route templates take precedence and use their persisted waiting rate', () => {
  const data = makePricingData();
  data.routeTemplates.push({
    id: 'template-one-way',
    pickupArea: 'Alpha Terminal',
    dropArea: 'Beta Terminal',
    vehicleId: 'minibus',
    tripType: 'one-way',
    price: 200,
    waitingChargePerHour: 40,
    radiusKm: 15
  });
  data.pricingMatrix.push({
    id: 'matrix-should-not-win',
    pickupArea: 'Any',
    dropArea: 'Any',
    vehicleId: 'minibus',
    tripType: 'one-way',
    baseFare: 999,
    includedLiveMileage: 999,
    includedDeadMileage: 999,
    waitingChargePerHour: 0,
    extraMileageRate: 1,
    distanceBands: [{ min: 0, max: null, rate: 1 }],
    nightRateMultiplier: 1,
    weekendRateMultiplier: 1,
    status: 'active'
  });

  const result = calculatePriceFromData(makePricingInput({ waitingMins: 90 }), data);

  assert.equal(result.baseFare, 200);
  assert.equal(result.waitingCharge, 60);
  assert.equal(result.finalFare, 260);
  assert.equal(result.isManualQuote, false);
});

test('route templates distinguish one-way and return journeys', () => {
  const data = makePricingData();
  data.routeTemplates.push(
    {
      id: 'template-one-way',
      pickupArea: 'Alpha Terminal',
      dropArea: 'Beta Terminal',
      vehicleId: 'minibus',
      tripType: 'one-way',
      price: 200,
      waitingChargePerHour: 50,
      radiusKm: 15
    },
    {
      id: 'template-return',
      pickupArea: 'Alpha Terminal',
      dropArea: 'Beta Terminal',
      vehicleId: 'minibus',
      tripType: 'return',
      price: 350,
      waitingChargePerHour: 50,
      radiusKm: 15
    }
  );

  assert.equal(calculatePriceFromData(makePricingInput(), data).finalFare, 200);
  assert.equal(calculatePriceFromData(makePricingInput({
    journeyType: 'return',
    returnDate: '2026-08-03T18:00:00.000Z'
  }), data).finalFare, 350);
});

test('pricing matrices use the independently persisted distance-band rate', () => {
  const data = makePricingData();
  data.pricingMatrix.push({
    id: 'banded-global',
    scope: 'global',
    pickupArea: 'Any',
    dropArea: 'Any',
    vehicleId: '',
    tripType: 'any',
    baseFare: 100,
    includedLiveMileage: 10,
    includedDeadMileage: 5,
    waitingChargePerHour: 60,
    extraMileageRate: 1,
    distanceBands: [
      { min: 0, max: 100, rate: 2 },
      { min: 100, max: 200, rate: 3 },
      { min: 200, max: null, rate: 4 }
    ],
    nightRateMultiplier: 1,
    weekendRateMultiplier: 1,
    status: 'active'
  });

  const result = calculatePriceFromData(makePricingInput({
    liveKm: 80,
    deadKm: 30,
    waitingMins: 30
  }), data);

  assert.equal(result.baseFare, 100);
  assert.equal(result.extraLiveMileageCharge, 210);
  assert.equal(result.extraDeadMileageCharge, 75);
  assert.equal(result.waitingCharge, 30);
  assert.equal(result.finalFare, 415);
});

test('matrix scope priority is city, then fleet, then global', () => {
  const data = makePricingData();
  const common = {
    tripType: 'any',
    includedLiveMileage: 1000,
    includedDeadMileage: 1000,
    waitingChargePerHour: 0,
    extraMileageRate: 1,
    distanceBands: [{ min: 0, max: null, rate: 1 }],
    nightRateMultiplier: 1,
    weekendRateMultiplier: 1,
    status: 'active'
  };
  data.pricingMatrix.push(
    { ...common, id: 'global', scope: 'global', pickupArea: 'Any', dropArea: 'Any', vehicleId: '', baseFare: 100 },
    { ...common, id: 'fleet', scope: 'fleet', pickupArea: 'Any', dropArea: 'Any', vehicleId: 'minibus', baseFare: 200 },
    { ...common, id: 'city', scope: 'city', pickupArea: 'Alpha Terminal', dropArea: 'Beta Terminal', vehicleId: 'minibus', baseFare: 300 }
  );

  assert.equal(calculatePriceFromData(makePricingInput(), data).finalFare, 300);
  assert.equal(calculatePriceFromData(makePricingInput({
    originName: 'Gamma Terminal',
    destinationName: 'Delta Terminal'
  }), data).finalFare, 200);
  assert.equal(calculatePriceFromData(makePricingInput({ vehicleId: 'coach' }), data).finalFare, 155);
});

test('seasonal rules honor applicability and highest priority override', () => {
  const data = makePricingData();
  data.routeTemplates.push({
    id: 'base-template',
    pickupArea: 'Alpha Terminal',
    dropArea: 'Beta Terminal',
    vehicleId: 'minibus',
    tripType: 'one-way',
    price: 200,
    waitingChargePerHour: 50,
    radiusKm: 15
  });
  data.seasonalPricing.push(
    {
      id: 'lower-priority',
      seasonName: 'Peak multiplier',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      multiplier: 2,
      applicableRoutes: ['Any'],
      applicableVehicles: ['Any'],
      priority: 1,
      enabled: true
    },
    {
      id: 'higher-priority',
      seasonName: 'Contract fare',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      overrideFare: 275,
      applicableRoutes: ['Any'],
      applicableVehicles: ['minibus'],
      priority: 10,
      enabled: true
    },
    {
      id: 'wrong-vehicle',
      seasonName: 'Coach only',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      overrideFare: 999,
      applicableRoutes: ['Any'],
      applicableVehicles: ['coach'],
      priority: 100,
      enabled: true
    }
  );

  const result = calculatePriceFromData(makePricingInput(), data);

  assert.equal(result.finalFare, 275);
  assert.equal(result.seasonalMultiplier, 1);
});

test('seasonal multipliers apply when no override is configured', () => {
  const data = makePricingData();
  data.routeTemplates.push({
    id: 'base-template',
    pickupArea: 'Alpha Terminal',
    dropArea: 'Beta Terminal',
    vehicleId: 'minibus',
    tripType: 'one-way',
    price: 200,
    waitingChargePerHour: 50,
    radiusKm: 15
  });
  data.seasonalPricing.push({
    id: 'peak',
    seasonName: 'Peak',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    multiplier: 1.5,
    applicableRoutes: ['Any'],
    applicableVehicles: ['Any'],
    priority: 1,
    enabled: true
  });

  const result = calculatePriceFromData(makePricingInput(), data);

  assert.equal(result.seasonalMultiplier, 1.5);
  assert.equal(result.finalFare, 300);
});

test('cost-model pricing separates the customer fare from operating cost', () => {
  const result = calculatePriceFromData(makePricingInput(), makePricingData());

  assert.equal(result.baseFare, 123);
  assert.equal(result.driverCost, 30);
  assert.equal(result.finalFare, 125);
  assert.equal(result.upperBoundFare, 140);
  assert.equal(result.breakdown.distanceCost, 54);
  assert.equal(result.breakdown.atomicMileageCost, 54);
  assert.equal(result.breakdown.totalOperatingCost, 87.33);
  assert.equal(
    result.breakdown.totalOperatingCost,
    result.breakdown.fuelCost + result.breakdown.maintenanceCost + result.breakdown.tyreCost + result.breakdown.driverCost + result.breakdown.allocatedStanding + result.breakdown.allocatedOverhead
  );
  assert.equal(result.pricingMethod, 'cost-model');
  assert.equal(result.isManualQuote, true);
});

test('weekend driver cost cannot reduce the calibrated customer fare', () => {
  const result = calculatePriceFromData(makePricingInput({
    departureDate: '2026-08-08T12:00:00'
  }), makePricingData());

  assert.equal(result.driverCost, 40);
  assert.equal(result.finalFare, 125);
});

test('holiday driver cost cannot reduce the calibrated customer fare', () => {
  const data = makePricingData();
  data.seasonalPricing.push({
    id: 'holiday-period',
    seasonName: 'Holiday period',
    startDate: '2026-08-01',
    endDate: '2026-08-07',
    multiplier: 1,
    applicableRoutes: ['Any'],
    applicableVehicles: ['Any'],
    priority: 1,
    enabled: true
  });

  const result = calculatePriceFromData(makePricingInput(), data);

  assert.equal(result.driverCost, 44);
  assert.equal(result.finalFare, 125);
});

test('an M6 Toll charge is included only when the routed journey uses it', () => {
  const withoutToll = calculatePriceFromData(makePricingInput(), makePricingData());
  const withToll = calculatePriceFromData(makePricingInput({ usesM6Toll: true }), makePricingData());

  assert.equal(withoutToll.surchargeLines.some((line: any) => /M6 Toll/.test(line.label)), false);
  assert.deepEqual(
    withToll.surchargeLines.find((line: any) => /M6 Toll/.test(line.label)),
    { label: 'M6 Toll (PSV)', cost: 6.5 }
  );
  assert.equal(withToll.finalFare, 130);
});

test('multi-day pricing follows the supplied zero standing and overnight policy', () => {
  const result = calculatePriceFromData(makePricingInput({
    totalDurationMinutes: 600,
    departureDate: '2026-08-03T12:00:00',
    returnDate: '2026-08-05T12:00:00'
  }), makePricingData());

  assert.equal(result.baseFare, 123);
  assert.equal(result.driverCost, 150);
  assert.equal(result.surchargeTotal, 0);
  assert.equal(result.breakdown.standingCost, 0);
  assert.equal(result.breakdown.overnightCost, 0);
  assert.equal(result.finalFare, 230);
  assert.equal(result.dualCrew, false);
});

test('pricing uses the Admin-configured ten-hour daily driving limit', () => {
  const result = calculatePriceFromData(makePricingInput({
    totalDurationMinutes: 1800,
    departureDate: '2026-08-03T12:00:00',
    returnDate: '2026-08-05T12:00:00'
  }), makePricingData());

  assert.equal(result.dualCrew, false);
  assert.equal(result.driverCost, 495);
  assert.equal(result.breakdown.driverCount, 1);
  assert.equal(result.breakdown.mandatoryBreakHours, 3);
  assert.equal(result.surchargeTotal, 0);
});

test('disabled Admin driver and customer-range rules are not applied', () => {
  const data = makePricingData();
  Object.assign(data.globalVars, {
    dailyDrivingLimitEnabled: false,
    drivingBreakTriggerEnabled: false,
    drivingBreakDurationEnabled: false,
    customerRangeUpliftEnabled: false
  });
  const result = calculatePriceFromData(makePricingInput({ totalDurationMinutes: 1800 }), data);

  assert.equal(result.breakdown.driverCount, 1);
  assert.equal(result.breakdown.mandatoryBreakHours, 0.75);
  assert.equal(result.upperBoundFare, result.finalFare);
});

test('company overhead is covered by the minimum profitable fare', () => {
  const data = makePricingData();
  data.annualOverheads = [{ id: 1, label: 'Company overhead', cost: 36500 }];

  const result = calculatePriceFromData(makePricingInput({
    liveKm: 0,
    deadKm: 0,
    liveDurationMinutes: 0,
    totalDurationMinutes: 0
  }), data);

  assert.equal(result.finalFare, 30);
  assert.ok(result.finalFare >= result.breakdown.profitFloor);
});

test('customer waiting is charged separately and never replaces mandatory breaks', () => {
  const result = calculatePriceFromData(makePricingInput({
    journeyType: 'return',
    returnDate: '2026-08-03T20:00:00.000Z',
    totalDurationMinutes: 420,
    waitingMins: 120
  }), makePricingData());

  assert.equal(result.waitingCharge, 100);
  assert.equal(result.breakdown.waitingHours, 2);
  assert.equal(result.breakdown.mandatoryBreakHours, 0.5);
});

test('driver cost includes the pre- and post-trip vehicle walkaround check', () => {
  const withoutCheck = calculatePriceFromData(makePricingInput({ totalDurationMinutes: 120 }), makePricingData());

  const dataWithCheck = makePricingData();
  dataWithCheck.globalVars.walkaroundCheckMinutes = 30;
  const withCheck = calculatePriceFromData(makePricingInput({ totalDurationMinutes: 120 }), dataWithCheck);

  // 30 min before + 30 min after = 1 extra driving hour at the weekday driver wage (£15).
  assert.equal(withCheck.driverCost - withoutCheck.driverCost, 15);
});

test('loss-making fixed prices are raised only to the shared profit floor', () => {
  const data = makePricingData();
  data.routeTemplates.push({
    id: 'loss-template', pickupArea: 'Alpha Terminal', dropArea: 'Beta Terminal',
    vehicleId: 'coach', tripType: 'one-way', price: 100, waitingChargePerHour: 50, radiusKm: 15
  });

  const result = calculatePriceFromData(makePricingInput({ vehicleId: 'coach' }), data);
  assert.equal(result.finalFare, 155);
  assert.ok(result.finalFare >= result.breakdown.profitFloor);
});

test('company booking calibration covers short return, airport one-way and long return coaches', () => {
  const data = makePricingData();
  data.surcharges = { m6Toll: 0, dartford: 0, ulez: 0, birminghamCaz: 0, driverOvernightSubsistence: 0 };
  const shortReturn = calculatePriceFromData(makePricingInput({
    vehicleId: 'coach', journeyType: 'return', liveKm: 65, deadKm: 0,
    liveDurationMinutes: 96, totalDurationMinutes: 96,
    returnDate: '2026-08-03T20:00:00.000Z'
  }), data);
  const airportOneWay = calculatePriceFromData(makePricingInput({
    vehicleId: 'coach', liveKm: 169, deadKm: 35,
    liveDurationMinutes: 124, totalDurationMinutes: 156
  }), data);
  const longReturn = calculatePriceFromData(makePricingInput({
    vehicleId: 'coach', journeyType: 'return', liveKm: 398, deadKm: 0,
    liveDurationMinutes: 282, totalDurationMinutes: 282,
    returnDate: '2026-08-03T20:00:00.000Z'
  }), data);
  assert.deepEqual([shortReturn.finalFare, airportOneWay.finalFare, longReturn.finalFare], [105, 470, 440]);
  for (const result of [shortReturn, airportOneWay, longReturn]) {
    assert.ok(result.finalFare >= result.breakdown.profitFloor);
  }
});

test('manual pricing rejects missing business configuration instead of using hidden defaults', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (data: any) => void;
    input?: Record<string, unknown>;
    expected: RegExp;
  }> = [
    {
      name: 'driver wage',
      mutate: data => {
        delete data.globalVars.driverWageWeekday;
        delete data.globalVars.driverHourlyWage;
      },
      expected: /driver hourly wage/
    },
    {
      name: 'M6 Toll',
      mutate: data => { delete data.surcharges.m6Toll; },
      input: { usesM6Toll: true },
      expected: /M6 Toll surcharge/
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const data = makePricingData();
      scenario.mutate(data);
      assert.throws(
        () => calculatePriceFromData(makePricingInput(scenario.input), data),
        (error: unknown) => error instanceof PricingConfigurationError && scenario.expected.test(error.message)
      );
    });
  }
});

test('missing minimum hire falls back to the live fleet-economics calculation instead of rejecting the quote', () => {
  const data = makePricingData();
  delete data.vehicles[0].minimumHire;
  const result = calculatePriceFromData(makePricingInput(), data);
  assert.ok(result.finalFare > 0);
});

test('quote still succeeds when minimum hire cannot be determined at all, protected by the profit floor', () => {
  const data = makePricingData();
  delete data.vehicles[0].minimumHire;
  data.vehicles[0].annualCosts = [];
  const result = calculatePriceFromData(makePricingInput(), data);
  assert.ok(result.finalFare > 0);
  assert.ok(result.finalFare >= result.breakdown.profitFloor);
});

test('missing vehicle operating rate still prices the trip from fuel/maintenance/tyre costs', () => {
  const data = makePricingData();
  delete data.vehicles[0].ratePerKm;
  const result = calculatePriceFromData(makePricingInput(), data);
  assert.ok(result.finalFare > 0);
});

test('template pricing requires a waiting-rate configuration only when waiting is requested', () => {
  const data = makePricingData();
  delete data.globalVars.waitingChargePerHour;
  data.routeTemplates.push({
    id: 'template',
    pickupArea: 'Alpha Terminal',
    dropArea: 'Beta Terminal',
    vehicleId: 'minibus',
    tripType: 'one-way',
    price: 200,
    radiusKm: 15
  });

  assert.equal(calculatePriceFromData(makePricingInput(), data).finalFare, 200);
  assert.throws(
    () => calculatePriceFromData(makePricingInput({ waitingMins: 30 }), data),
    /template waiting charge per hour/
  );
});

test('matrix pricing rejects missing bands and distance gaps instead of inventing a rate', () => {
  const dataWithoutBands = makePricingData();
  const matrix = {
    id: 'invalid-matrix',
    scope: 'global',
    pickupArea: 'Any',
    dropArea: 'Any',
    vehicleId: '',
    tripType: 'any',
    baseFare: 100,
    includedLiveMileage: 0,
    includedDeadMileage: 0,
    waitingChargePerHour: 0,
    nightRateMultiplier: 1,
    weekendRateMultiplier: 1,
    status: 'active'
  } as any;
  dataWithoutBands.pricingMatrix.push(matrix);

  assert.throws(
    () => calculatePriceFromData(makePricingInput(), dataWithoutBands),
    /requires stored distance bands/
  );

  const dataWithGap = makePricingData();
  dataWithGap.pricingMatrix.push({
    ...matrix,
    distanceBands: [{ min: 0, max: 50, rate: 2 }]
  });
  assert.throws(
    () => calculatePriceFromData(makePricingInput(), dataWithGap),
    /has no band for 120 km/
  );
});
