export interface ThreatZoneRisk {
  threatZone: string;
  riskDescription: string;
  owaspMapping: string;
  countermeasure: string;
  status: 'Enforced' | 'Verified';
}