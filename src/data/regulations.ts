import type { RegulatoryAgency } from './types';

/**
 * Philippine government agencies whose mandates commonly intersect with
 * domestic/inter-island shipping, freight forwarding, and logistics audit
 * findings. Legal bases were verified against publicly available legislative
 * sources at the time of writing (2026). Confirm current issuances, circulars,
 * and organizational changes against the agency's official website before
 * citing in a final audit report.
 */
export const regulatoryAgencies: RegulatoryAgency[] = [
  {
    id: 'marina',
    acronym: 'MARINA',
    name: 'Maritime Industry Authority',
    parentDepartment: 'Department of Transportation (DOTr)',
    mandate:
      'Single maritime administration for the Philippines. Regulates and supervises shipping lines, shipyards, ship registration and documentation, vessel safety standards, ship manning, and shipping/freight forwarding enterprises.',
    legalBasis: [
      'Presidential Decree No. 474 (1974) — Maritime Industry Decree, created MARINA',
      'Republic Act No. 9295 (2004) — Domestic Shipping Development Act',
      'Republic Act No. 10635 (2014) — Designates MARINA as sole STCW maritime administration',
    ],
    relevanceToShipping:
      'Vessel seaworthiness, crewing/certification, domestic shipping franchises, cargo/passenger insurance requirements, and freight forwarder/ship agency accreditation.',
    keywords: [
      'vessel', 'ship', 'seaworthy', 'seaworthiness', 'crew', 'crewing', 'manning',
      'ship registration', 'franchise', 'domestic shipping', 'ship agent', 'ship agency',
      'freight forwarder', 'cargo insurance', 'certificate of inspection', 'drydock',
    ],
    website: 'https://marina.gov.ph',
  },
  {
    id: 'ppa',
    acronym: 'PPA',
    name: 'Philippine Ports Authority',
    parentDepartment: 'Department of Transportation (DOTr)',
    mandate:
      'Administers, operates, and regulates ports and port terminals nationwide; controls and supervises pilotage, cargo handling, and port operations, including cargo/wharfage fees and terminal handling.',
    legalBasis: [
      'Presidential Decree No. 505 (1974), reorganized by Presidential Decree No. 857 (1975) — PPA Charter',
    ],
    relevanceToShipping:
      'Port entry/exit procedures, berthing, cargo handling and storage at ports, wharfage and port charges, pilotage, and port terminal safety.',
    keywords: [
      'port', 'terminal', 'wharf', 'wharfage', 'berth', 'berthing', 'pilotage',
      'cargo handling', 'stevedoring', 'arrastre', 'port charges', 'container yard',
    ],
    website: 'https://www.ppa.com.ph',
  },
  {
    id: 'pcg',
    acronym: 'PCG',
    name: 'Philippine Coast Guard',
    parentDepartment: 'Department of Transportation (DOTr)',
    mandate:
      'Enforces maritime safety, security, and marine environmental protection laws; conducts vessel inspections, port state control, search and rescue, and investigates marine casualties and pollution incidents.',
    legalBasis: [
      'Republic Act No. 9993 (2009) — Philippine Coast Guard Law of 2009',
    ],
    relevanceToShipping:
      'Vessel safety inspections, life-saving/fire-fighting equipment compliance, marine pollution prevention, dangerous/hazardous cargo carriage rules, and incident/accident reporting.',
    keywords: [
      'safety inspection', 'life-saving', 'fire-fighting', 'marine pollution', 'oil spill',
      'dangerous goods', 'hazardous cargo', 'marine casualty', 'accident report', 'overloading',
      'life jacket', 'search and rescue',
    ],
    website: 'https://www.coastguard.gov.ph',
  },
  {
    id: 'boc',
    acronym: 'BOC',
    name: 'Bureau of Customs',
    parentDepartment: 'Department of Finance (DOF)',
    mandate:
      'Administers and enforces customs and tariff laws, including assessment and collection of duties/taxes on imported and exported goods, and customs clearance of cargo and carriers.',
    legalBasis: [
      'Republic Act No. 10863 (2016) — Customs Modernization and Tariff Act (CMTA)',
    ],
    relevanceToShipping:
      'Import/export documentation, cargo manifest accuracy, customs clearance timelines, dutiable/duty-free classification, and bonded warehouse compliance.',
    keywords: [
      'customs', 'duty', 'duties', 'tariff', 'manifest', 'import', 'export', 'clearance',
      'bonded warehouse', 'consignee', 'declaration', 'smuggling', 'contraband',
    ],
    website: 'https://customs.gov.ph',
  },
  {
    id: 'dotr',
    acronym: 'DOTr',
    name: 'Department of Transportation',
    mandate:
      'Formulates national transportation policy and exercises administrative supervision over MARINA, PPA, PCG, LTFRB, LTO, and CAAP; reviews agency decisions on appeal.',
    legalBasis: [
      'Executive Order No. 125 (1987), as amended — reorganized the Ministry/Department of Transportation',
    ],
    relevanceToShipping:
      'Overall transport policy direction, inter-agency coordination on maritime and logistics matters, and appellate review of MARINA/PPA/PCG administrative decisions.',
    keywords: ['transport policy', 'inter-agency', 'appeal', 'department of transportation'],
    website: 'https://dotr.gov.ph',
  },
  {
    id: 'dmw',
    acronym: 'DMW',
    name: 'Department of Migrant Workers',
    mandate:
      'Regulates deployment of Filipino seafarers and land-based overseas workers, licenses manning agencies, and enforces employment contract standards (absorbed the POEA in 2022).',
    legalBasis: [
      'Republic Act No. 11641 (2022) — Department of Migrant Workers Act (succeeded POEA)',
    ],
    relevanceToShipping:
      'Seafarer deployment contracts, manning agency accreditation, and crew welfare/labor standards for shipboard personnel.',
    keywords: [
      'seafarer', 'manning agency', 'poea', 'dmw', 'crew contract', 'overseas worker',
      'seaman', 'deployment',
    ],
    website: 'https://dmw.gov.ph',
  },
  {
    id: 'denr-emb',
    acronym: 'DENR-EMB',
    name: 'Environmental Management Bureau (DENR)',
    parentDepartment: 'Department of Environment and Natural Resources (DENR)',
    mandate:
      'Implements environmental impact assessment, pollution control, and hazardous/solid waste regulations applicable to port, warehouse, and fleet operations.',
    legalBasis: [
      'Presidential Decree No. 1586 (1978) — Philippine Environmental Impact Statement System',
      'Republic Act No. 8749 (1999) — Philippine Clean Air Act',
      'Republic Act No. 9275 (2004) — Philippine Clean Water Act',
      'Republic Act No. 6969 (1990) — Toxic Substances and Hazardous and Nuclear Wastes Control Act',
    ],
    relevanceToShipping:
      'Environmental compliance certificates for terminals/warehouses, fuel/oil spill handling, hazardous waste disposal (e.g., used oil, batteries), and vehicle/vessel emissions.',
    keywords: [
      'environmental compliance', 'ecc', 'hazardous waste', 'oil spill', 'emission',
      'waste disposal', 'pollution', 'used oil',
    ],
    website: 'https://emb.gov.ph',
  },
  {
    id: 'dole',
    acronym: 'DOLE',
    name: 'Department of Labor and Employment',
    mandate:
      'Enforces labor standards, occupational safety and health, and employee welfare requirements applicable to warehouse, port, and driving personnel.',
    legalBasis: [
      'Presidential Decree No. 442 — Labor Code of the Philippines',
      'Republic Act No. 11058 (2018) — Occupational Safety and Health Standards Act',
    ],
    relevanceToShipping:
      'Working hours and overtime for drivers/dock workers, workplace safety at warehouses/terminals, and mandatory OSH programs and reporting.',
    keywords: [
      'overtime', 'working hours', 'occupational safety', 'osh', 'workplace safety',
      'labor standards', 'employee welfare', 'safety officer',
    ],
    website: 'https://dole.gov.ph',
  },
  {
    id: 'dti',
    acronym: 'DTI',
    name: 'Department of Trade and Industry',
    mandate:
      'Registers business names, oversees fair trade and consumer protection, and accredits/monitors freight forwarders and cargo consolidators together with the Philippine Shippers\' Bureau.',
    legalBasis: [
      'Republic Act No. 7394 — Consumer Act of the Philippines',
    ],
    relevanceToShipping:
      'Freight forwarder/cargo consolidator accreditation, advertising and pricing disclosures, and consumer complaint handling for shipping/logistics services.',
    keywords: [
      'freight forwarder accreditation', 'consumer complaint', 'fair trade', 'business registration',
      'shippers bureau', 'consolidator',
    ],
    website: 'https://www.dti.gov.ph',
  },
  {
    id: 'ltfrb-lto',
    acronym: 'LTFRB / LTO',
    name: 'Land Transportation Franchising & Regulatory Board / Land Transportation Office',
    parentDepartment: 'Department of Transportation (DOTr)',
    mandate:
      'Regulates franchises for public land transport (trucking/hauling routes) and registration/roadworthiness of motor vehicles used in inland cargo movement.',
    legalBasis: [
      'Executive Order No. 202 (1987) — created LTFRB',
      'Republic Act No. 4136 — Land Transportation and Traffic Code',
    ],
    relevanceToShipping:
      'Trucking/hauling franchise compliance, vehicle registration and roadworthiness for last-mile and drayage operations, and driver licensing.',
    keywords: [
      'trucking', 'hauler', 'hauling', 'delivery van', 'vehicle registration', 'driver license',
      'roadworthy', 'franchise', 'drayage',
    ],
    website: 'https://ltfrb.gov.ph',
  },
];
