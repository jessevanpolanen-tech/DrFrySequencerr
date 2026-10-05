// ── Ideal-customer profiles, per brand ──────────────────────────────
// What each brand is looking for. Drives discovery presets, the rule score,
// the LLM qualification brief and the signal search. Copy and targeting only —
// no keys or addresses here (those are deployment env, like lib/sequences.js).
//
// There is deliberately no default profile: an unknown tenant throws, so a
// typo can never run Dr. Fry's targeting under FahCel's name or vice versa.

export const ICP = {
  fahcel: {
    brief:
`FahCel sells tamper-evident cold-chain compliance: every temperature-logger reading is sealed into a hash-chained record at ingestion, so a shipper can prove the cold chain held per shipment (retail audits, GDP inspections, lost-cold claims). FahCel also resells Elitech USB/4G temperature loggers.
A good fit ships or stores temperature-sensitive goods and answers to an auditor or a customer for it: pharmaceutical wholesalers and distributors under EU GDP, temperature-controlled 3PLs and couriers, clinical-trial logistics, vaccine distribution, hospital and outpatient pharmacy logistics, and frozen/chilled food exporters (seafood, meat, dairy) facing retail audits.
Not a fit: temperature-monitoring vendors and logger manufacturers (competitors), consultancies, recruiters, job boards, directories, news sites, consumer shops, and companies with no physical cold chain.`,
    countries: ['NL', 'BE', 'DE', 'DK', 'SE', 'NO', 'FI', 'LU'],
    tlds: ['nl', 'be', 'de', 'dk', 'se', 'no', 'fi', 'lu', 'eu'],
    geoWords: ['netherlands', 'nederland', 'belgium', 'belgië', 'germany', 'deutschland', 'denmark', 'sweden', 'norway', 'finland', 'benelux', 'europe'],
    keywords: [
      'gdp', 'good distribution practice', 'cold chain', 'cold-chain', 'koelketen', 'kühlkette',
      'temperature-controlled', 'temperature controlled', 'temperatuurgecontroleerd', '2-8', '2–8',
      'pharma', 'pharmaceutical', 'farmaceutisch', 'groothandel', 'wholesale', 'wholesaler',
      'distribution', 'logistics', 'logistiek', '3pl', 'vaccine', 'vaccin', 'clinical trial',
      'frozen', 'diepvries', 'chilled', 'gekoeld', 'reefer', 'seafood', 'vis', 'cold storage', 'koelhuis',
    ],
    negativeKeywords: ['temperature monitoring solution', 'data logger manufacturer', 'vacatures', 'job board', 'recruitment agency'],
    // Competitors and our own supplier: never prospect them.
    excludeDomains: ['testo.com', 'eupry.com', 'elpro.com', 'sensitech.com', 'berlinger.com', 'elitecheu.com', 'elitechus.com', 'tempsen.com', 'fahcel.eu'],
    titles: [
      'quality assurance', 'qa manager', 'head of quality', 'quality manager', 'kwaliteit',
      'responsible person', 'qualified person', 'gdp', 'compliance',
      'supply chain', 'logistics', 'logistiek', 'operations', 'warehouse', 'magazijn', 'distribution',
    ],
    signalTerms: '("new facility" OR warehouse OR expansion OR "cold storage" OR GDP OR acquisition OR "nieuwe vestiging" OR uitbreiding OR distributiecentrum)',
    minScore: 60,
    serp: { gl: 'nl', hl: 'en' },
    presets: {
      'nl-pharma-wholesale': 'farmaceutische groothandel GDP Nederland',
      'nl-pharma-3pl': 'temperature controlled pharmaceutical logistics Netherlands',
      'benelux-clinical-logistics': 'clinical trial logistics cold chain Benelux',
      'nl-frozen-seafood-export': 'diepvries vis exporteur Nederland',
      'eu-cold-storage': 'GDP cold storage warehouse Europe pharma',
    },
  },

  drfry: {
    brief:
`Dr. Fry sells ProWave, a device that extends commercial frying-oil life, so kitchens buy less oil and dispose of less waste. Field-tested with convenience-store chains in Japan.
A good fit runs commercial fryers at volume: quick-service and fast-food chains, snackbar/cafetaria chains, convenience-store chains with hot food, contract caterers, and food producers with industrial frying lines.
Not a fit: single home cooks, recipe blogs, oil suppliers, fryer manufacturers, directories, news sites, and restaurants with no frying.`,
    countries: ['NL', 'BE', 'DE'],
    tlds: ['nl', 'be', 'de', 'eu'],
    geoWords: ['netherlands', 'nederland', 'belgium', 'belgië', 'benelux', 'germany'],
    keywords: [
      'frituur', 'friteuse', 'fryer', 'frying', 'fried', 'snackbar', 'cafetaria', 'fast food', 'quick service',
      'qsr', 'franchise', 'vestigingen', 'locations', 'catering', 'convenience', 'frites', 'patat', 'kroket',
    ],
    negativeKeywords: ['recept', 'recipe', 'vacatures', 'job board'],
    excludeDomains: ['drfry.nl'],
    titles: ['operations', 'operationeel', 'procurement', 'inkoop', 'facility', 'franchise', 'owner', 'eigenaar', 'directeur', 'ceo', 'sustainability', 'duurzaamheid'],
    signalTerms: '("new location" OR "nieuwe vestiging" OR opening OR expansion OR franchise OR sustainability OR duurzaamheid)',
    minScore: 60,
    serp: { gl: 'nl', hl: 'nl' },
    presets: {
      'nl-snackbar-chains': 'snackbar keten vestigingen Nederland',
      'nl-qsr-franchise': 'fastfood franchise Nederland vestigingen',
      'benelux-catering': 'contractcatering bedrijfsrestaurant Nederland',
    },
  },
};

export function getIcp(tenant) {
  const t = (tenant || '').toString().trim().toLowerCase();
  const icp = ICP[t];
  if (!icp) throw new Error(`no ICP defined for tenant "${t}" (known: ${Object.keys(ICP).join(', ')})`);
  return icp;
}
