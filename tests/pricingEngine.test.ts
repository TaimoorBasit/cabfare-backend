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
  assert.equal(calculatePriceFromData(makePricingInput({ vehicleId: 'coach' }), data).finalFare, 100);
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

test('manual pricing uses persisted running costs, wage, holiday pay and margin', () => {
  const result = calculatePriceFromData(makePricingInput(), makePricingData());

  assert.equal(result.baseFare, 101);
  assert.equal(result.driverCost, 44);
  assert.equal(result.finalFare, 122);
  assert.equal(result.upperBoundFare, result.finalFare);
  assert.equal(result.isManualQuote, true);
});

test('weekend pricing uses the configured weekend wage and margin', () => {
  const result = calculatePriceFromData(makePricingInput({
    departureDate: '2026-08-08T12:00:00'
  }), makePricingData());

  assert.equal(result.driverCost, 55);
  assert.equal(result.finalFare, 140);
});

test('holiday pricing uses the configured holiday wage and margin', () => {
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

  assert.equal(result.driverCost, 66);
  assert.equal(result.finalFare, 160);
});

test('an M6 Toll charge is included only when the routed journey uses it', () => {
  const withoutToll = calculatePriceFromData(makePricingInput(), makePricingData());
  const withToll = calculatePriceFromData(makePricingInput({ usesM6Toll: true }), makePricingData());

  assert.equal(withoutToll.surchargeLines.some((line: any) => /M6 Toll/.test(line.label)), false);
  assert.deepEqual(
    withToll.surchargeLines.find((line: any) => /M6 Toll/.test(line.label)),
    { label: 'M6 Toll (PSV)', cost: 6.5 }
  );
  assert.equal(withToll.finalFare, 129);
});

test('multi-day pricing adds standing costs, subsistence and accommodation once per night', () => {
  const result = calculatePriceFromData(makePricingInput({
    totalDurationMinutes: 600,
    departureDate: '2026-08-03T12:00:00',
    returnDate: '2026-08-05T12:00:00'
  }), makePricingData());

  assert.equal(result.baseFare, 284);
  assert.equal(result.driverCost, 220);
  assert.equal(result.surchargeTotal, 260);
  assert.equal(result.finalFare, 653);
  assert.equal(result.dualCrew, false);
});

test('multi-day pricing assigns dual crew when the average daily shift exceeds nine hours', () => {
  const result = calculatePriceFromData(makePricingInput({
    totalDurationMinutes: 1800,
    departureDate: '2026-08-03T12:00:00',
    returnDate: '2026-08-05T12:00:00'
  }), makePricingData());

  assert.equal(result.dualCrew, true);
  assert.equal(result.driverCost, 1320);
  assert.equal(result.surchargeTotal, 420);
});

test('minimum hire applies the persisted per-unit company overhead', () => {
  const data = makePricingData();
  data.annualOverheads = [{ id: 1, label: 'Company overhead', cost: 36500 }];

  const result = calculatePriceFromData(makePricingInput({
    liveKm: 0,
    deadKm: 0,
    liveDurationMinutes: 0,
    totalDurationMinutes: 0
  }), data);

  assert.equal(result.finalFare, 28);
});

test('manual pricing rejects missing business configuration instead of using hidden defaults', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (data: any) => void;
    input?: Record<string, unknown>;
    expected: RegExp;
  }> = [
    {
      name: 'fuel price',
      mutate: data => { delete data.globalVars.fuelPricePerLitre; },
      expected: /fuel price per litre/
    },
    {
      name: 'fuel consumption',
      mutate: data => { delete data.vehicles[0].fuelKpl; },
      expected: /vehicle fuel consumption/
    },
    {
      name: 'tyre costs',
      mutate: data => {
        delete data.vehicles[0].tyreCostPerKm;
        delete data.vehicles[0].tyreSetCost;
        delete data.vehicles[0].expectedTyreLifeKm;
      },
      expected: /vehicle tyre cost/
    },
    {
      name: 'maintenance cost',
      mutate: data => { delete data.vehicles[0].maintenanceCostPerKm; },
      expected: /vehicle maintenance cost/
    },
    {
      name: 'driver wage',
      mutate: data => {
        delete data.globalVars.driverWageWeekday;
        delete data.globalVars.driverHourlyWage;
      },
      expected: /driver hourly wage/
    },
    {
      name: 'holiday pay',
      mutate: data => { delete data.globalVars.holidayPayPct; },
      expected: /holiday pay percentage/
    },
    {
      name: 'profit margin',
      mutate: data => {
        delete data.globalVars.marginWeekday;
        delete data.globalVars.profitMarginPct;
      },
      expected: /profit margin percentage/
    },
    {
      name: 'M6 Toll',
      mutate: data => { delete data.surcharges.m6Toll; },
      input: { usesM6Toll: true },
      expected: /M6 Toll surcharge/
    },
    {
      name: 'overnight subsistence',
      mutate: data => { delete data.surcharges.driverOvernightSubsistence; },
      input: { returnDate: '2026-08-05T12:00:00' },
      expected: /driver overnight subsistence/
    },
    {
      name: 'overnight accommodation',
      mutate: data => { delete data.globalVars.overnightCost; },
      input: { returnDate: '2026-08-05T12:00:00' },
      expected: /driver overnight accommodation/
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
