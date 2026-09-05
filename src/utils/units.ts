// Canonical Unit Standards:
// 1 UK Imperial Gallon = 4.54609 Litres (never US gallon)
// 1 Mile = 1.609344 Kilometres (exact international standard)

export const MILES_TO_KM = 1.609344;
export const KM_TO_MILES = 1 / 1.609344;
export const LITRES_PER_UK_GALLON = 4.54609;
export const UK_GALLONS_PER_LITRE = 1 / 4.54609;

export type DistanceUnit = 'miles' | 'km';
export type FuelUnit = 'gallons' | 'litres';

// Distance conversions (canonical base: km)
export const kmToMiles = (km: number): number => Number(km || 0) * KM_TO_MILES;
export const milesToKm = (miles: number): number => Number(miles || 0) * MILES_TO_KM;

export const canonicalKmToDisplay = (km: number, targetUnit: DistanceUnit = 'km'): number => {
  return targetUnit === 'miles' ? kmToMiles(km) : Number(km || 0);
};

export const displayToCanonicalKm = (val: number, sourceUnit: DistanceUnit = 'km'): number => {
  return sourceUnit === 'miles' ? milesToKm(val) : Number(val || 0);
};

// Rate per distance conversions (canonical base: £/km)
// £/mile = £/km * 1.609344
export const ratePerKmToRatePerMile = (ratePerKm: number): number => Number(ratePerKm || 0) * MILES_TO_KM;
export const ratePerMileToRatePerKm = (ratePerMile: number): number => Number(ratePerMile || 0) * KM_TO_MILES;

export const canonicalRateToDisplay = (ratePerKm: number, targetUnit: DistanceUnit = 'km'): number => {
  return targetUnit === 'miles' ? ratePerKmToRatePerMile(ratePerKm) : Number(ratePerKm || 0);
};

export const displayToCanonicalRate = (val: number, sourceUnit: DistanceUnit = 'km'): number => {
  return sourceUnit === 'miles' ? ratePerMileToRatePerKm(val) : Number(val || 0);
};

// Fuel price conversions (canonical base: £/Litre)
// £/UK gallon = £/Litre * 4.54609
export const pricePerLitreToPricePerUkGallon = (pricePerLitre: number): number => Number(pricePerLitre || 0) * LITRES_PER_UK_GALLON;
export const pricePerUkGallonToPricePerLitre = (pricePerGallon: number): number => Number(pricePerGallon || 0) * UK_GALLONS_PER_LITRE;

export const canonicalFuelPriceToDisplay = (pricePerLitre: number, fuelUnit: FuelUnit = 'litres'): number => {
  return fuelUnit === 'gallons' ? pricePerLitreToPricePerUkGallon(pricePerLitre) : Number(pricePerLitre || 0);
};

export const displayToCanonicalFuelPrice = (val: number, fuelUnit: FuelUnit = 'litres'): number => {
  return fuelUnit === 'gallons' ? pricePerUkGallonToPricePerLitre(val) : Number(val || 0);
};

// Fuel economy conversions (canonical base: km/L)
export const getFuelEconomyFactor = (distanceUnit: DistanceUnit = 'km', fuelUnit: FuelUnit = 'litres'): number => {
  const distFactor = distanceUnit === 'miles' ? MILES_TO_KM : 1;
  const volFactor = fuelUnit === 'gallons' ? LITRES_PER_UK_GALLON : 1;
  return volFactor / distFactor;
};

export const canonicalKplToDisplayEconomy = (kpl: number, distanceUnit: DistanceUnit = 'km', fuelUnit: FuelUnit = 'litres'): number => {
  return Number(kpl || 0) * getFuelEconomyFactor(distanceUnit, fuelUnit);
};

export const displayEconomyToCanonicalKpl = (val: number, distanceUnit: DistanceUnit = 'km', fuelUnit: FuelUnit = 'litres'): number => {
  const factor = getFuelEconomyFactor(distanceUnit, fuelUnit);
  return factor > 0 ? Number(val || 0) / factor : Number(val || 0);
};
