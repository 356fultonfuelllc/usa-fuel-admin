// Standard compliance items and staff checklists for this station (356 Fulton St,
// Farmingdale, Nassau County), from 6 NYCRR Part 613, Nassau County Public Health
// Ordinance Article XV, 40 CFR 280 / 63 CCCCCC and NY State licensing rules, as
// researched in November 2026. Confirm site-specific items with the tank contractor
// and the Nassau County Department of Health (516-227-9691).

const PART613 = 'https://dec.ny.gov/sites/default/files/2024-01/part613.pdf';
const ARTXV = 'https://www.nassaucountyny.gov/DocumentCenter/View/26425/Article-XV';
const NCDOH = 'https://nassaucountyny.gov/4879/Petroleum-Bulk-Storage';

export const COMPLIANCE_CATEGORIES = [
  ['tanks', 'Tanks & fuel system'],
  ['licenses', 'Licenses & registrations'],
  ['safety', 'Fire & safety'],
  ['other', 'Other'],
];

// Questions whose answers decide which items apply.
export const COMPLIANCE_QUESTIONS = [
  'When were the tanks and piping installed (dates on the tank registration certificate)? Pressurized piping installed before Oct 12, 2015 that isn\'t monitored weekly needs a yearly line tightness test.',
  'Are the tanks and piping steel or fiberglass, and do any metal parts touch soil? If so, a corrosion (cathodic protection) test is due every year.',
  'Is there a rectifier box on a wall or post (impressed-current corrosion protection)? Then a 60-day rectifier log is required.',
  'Does the TLS-350 have between-wall sensors for every tank and sump? Are the line leak detectors mechanical or electronic?',
  'Are the spill buckets and sumps single- or double-walled? Double-walled ones checked at each walkthrough skip the 3-year test.',
  'How many gallons of gasoline were delivered in the last 12 months? This decides Stage I vapor testing (800,000 gal/yr under NY Part 230; 100,000 gal/month under the federal rule).',
  'Was the tank certificate issued by the Nassau County Department of Health or by NYSDEC, and when does it expire?',
  'What food and drinks are prepared on site? Hot food or self-serve coffee may need a Nassau County food service permit on top of the state retail food store license.',
  'Has the Village of Farmingdale or the Nassau County Fire Marshal issued any operating, sign or fire permits for this site?',
];

export const COMPLIANCE_ITEMS = [
  // ---- Tanks & fuel system ----
  {
    key: 'tank-registration', name: 'Tank registration renewal (Nassau County / NYSDEC)', category: 'tanks', every: 5, unit: 'years',
    who: 'Owner', agency: 'Nassau County Dept. of Health', record: 'Registration certificate / Permit to Operate, displayed on site',
    notes: 'Nassau runs the tank program here (Article XV). Registration lasts up to 5 years; set the exact expiration from your certificate with "Next due". Report changes (new operator, equipment) within 30 days.',
    source: NCDOH,
  },
  {
    key: 'annual-leak-detection-test', name: 'Annual leak detection operability test', category: 'tanks', every: 1, unit: 'years',
    who: 'Certified contractor', agency: 'NYSDEC / Nassau County', record: 'Test report, keep 3 years',
    notes: 'TLS-350 alarm, setup and battery backup; every probe and sensor; line leak detectors tested with a simulated 3 gph leak.',
    source: PART613,
  },
  {
    key: 'nassau-2yr-test', name: 'Nassau 2-year monitoring functionality test', category: 'tanks', every: 2, unit: 'years',
    who: 'Nassau-certified installer', agency: 'Nassau County Dept. of Health', record: 'Test results, keep 3 years',
    notes: 'All tank and sump sensors, the TLS and high-level alarm. Notify NCDOH 5 business days before; submit results within 10 business days. On a failure, call NCDOH right away and repair and retest within 48 hours or take the tank out of service.',
    source: ARTXV,
  },
  {
    key: 'spill-bucket-test', name: 'Spill bucket liquid-tightness test', category: 'tanks', every: 3, unit: 'years',
    who: 'Certified contractor', agency: 'NYSDEC', record: 'Test results until the next test (at least 3 years)',
    notes: 'Not needed for double-walled buckets whose between-wall space is checked at every monthly walkthrough.',
    source: PART613,
  },
  {
    key: 'overfill-inspection', name: 'Overfill prevention inspection', category: 'tanks', every: 3, unit: 'years',
    who: 'Certified contractor', agency: 'NYSDEC', record: 'Inspection results until the next one (at least 3 years)',
    notes: 'Confirms the overfill device is set to shut off or alarm at the right level and works when tested.',
    source: PART613,
  },
  {
    key: 'sump-test', name: 'Containment sump test (sumps used to monitor piping)', category: 'tanks', every: 3, unit: 'years',
    who: 'Certified contractor', agency: 'NYSDEC', record: 'Test results until the next test (at least 3 years)',
    notes: 'Only for sumps used for piping leak detection, and not needed if they are double-walled and checked at each walkthrough.',
    source: PART613,
  },
  {
    key: 'line-tightness', name: 'Line tightness test (if required)', category: 'tanks', every: 1, unit: 'years',
    who: 'Certified contractor', agency: 'NYSDEC / Nassau County', record: 'Test results until the next test (at least 3 years)',
    notes: 'Only for pressurized piping installed before Oct 12, 2015 that is not monitored weekly. Give NCDOH 5 business days\' notice and send results within 30 days. Remove this item if it doesn\'t apply.',
    source: PART613,
  },
  {
    key: 'cp-test', name: 'Corrosion protection (cathodic) test (if steel)', category: 'tanks', every: 1, unit: 'years',
    who: 'Qualified CP tester', agency: 'NYSDEC', record: 'Test results, keep 3 years',
    notes: 'Only if any tank, piping or metal connector in contact with soil is protected by cathodic protection. Remove this item if your system is all fiberglass.',
    source: PART613,
  },
  {
    key: 'rectifier', name: '60-day rectifier check (if impressed current)', category: 'tanks', every: 2, unit: 'months',
    who: 'Station staff', agency: 'NYSDEC', record: 'Volts, amps and hour-meter readings, keep 3 years',
    notes: 'Only with an impressed-current rectifier. Amps should be within 20% of the last annual test, the hour clock running, bonding cables secure.',
    source: PART613,
  },
  {
    key: 'stage1-vapor', name: 'Stage I vapor recovery tests (if required)', category: 'tanks', every: 3, unit: 'years',
    who: 'Certified tester', agency: 'NYSDEC Air / EPA', record: 'Latest test results on site; delivery records 2 years (5 under the federal rule)',
    notes: 'Pressure/vacuum vent valve and static pressure tests. Required at 800,000+ gallons of gasoline a year in the NYC metro area (NY Part 230), or 100,000+ gallons a month (federal). Results to DEC within 30 days. Stage II is no longer required.',
    source: 'https://extapps.dec.ny.gov/docs/air_pdf/sip230.pdf',
  },
  {
    key: 'operator-retest', name: 'Class A/B operator recertification', category: 'tanks', every: 5, unit: 'years',
    who: 'Class A/B operator', agency: 'NYSDEC', record: 'Operator certificates, kept while designated plus 3 years',
    notes: 'Every 5 years after the last certificate. A new A/B operator must be named within 30 days if one leaves. Class C operators (cashiers) must be trained by an A/B operator before working a shift; keep the training log.',
    source: PART613,
  },
  {
    key: 'pollution-insurance', name: 'Tank pollution liability insurance', category: 'tanks', every: 1, unit: 'years',
    who: 'Owner', agency: 'NYSDEC', record: 'Proof of coverage while the tanks are in use',
    notes: '$1 million per occurrence and $1 million annual aggregate. Set "Next due" to the policy renewal date.',
    source: PART613,
  },
  {
    key: 'weights-measures', name: 'Weights & measures dispenser inspection', category: 'tanks', every: 1, unit: 'years',
    who: 'Nassau County inspector', agency: 'Nassau County Consumer Affairs', record: 'Inspection seals / stickers on each dispenser',
    notes: 'The county inspects every dispenser at least once a year. Record the date of the last inspection sticker.',
    source: 'https://www.osc.ny.gov/files/local-government/audits/2024/pdf/nassau-county-S9-24-9.pdf',
  },
  // ---- Licenses & registrations ----
  {
    key: 'tobacco-registration', name: 'Cigarette & tobacco retail dealer registration', category: 'licenses', every: 1, unit: 'years',
    who: 'Owner', agency: 'NYS Tax Department', record: 'Certificate of registration, displayed',
    notes: 'Renew between Sept 1 and Sept 20 for the next calendar year ($300 per location). Set "Next due" to Sept 20.',
    source: 'https://www.tax.ny.gov/bus/cig/existing-business.htm',
  },
  {
    key: 'vape-registration', name: 'Vapor products dealer registration', category: 'licenses', every: 1, unit: 'years',
    who: 'Owner', agency: 'NYS Tax Department', record: 'Certificate of registration, displayed',
    notes: 'Same renewal window as tobacco: Sept 1–20 for the next calendar year ($300 per location).',
    source: 'https://www.tax.ny.gov/bus/vpt/',
  },
  {
    key: 'beer-license', name: 'Beer license (off-premises)', category: 'licenses', every: 3, unit: 'years',
    who: 'Owner', agency: 'NYS Liquor Authority', record: 'License, displayed',
    notes: 'Renews every 3 years. Set "Next due" to the expiration on the license.',
    source: 'https://sla.ny.gov/renew-your-license',
  },
  {
    key: 'food-store-license', name: 'Retail food store license', category: 'licenses', every: 2, unit: 'years',
    who: 'Owner', agency: 'NYS Agriculture & Markets', record: 'License, displayed',
    notes: '2-year license ($250). If hot food or self-serve coffee is prepared on site, ask NCDOH (516-227-9717) whether a food service permit is also needed.',
    source: 'https://www.nysenate.gov/legislation/laws/AGM/500-B',
  },
  {
    key: 'lottery-license', name: 'NY Lottery retailer license', category: 'licenses', every: '', unit: 'years',
    who: 'Owner', agency: 'NYS Gaming Commission', record: 'License',
    notes: 'The renewal cycle wasn\'t confirmed. Set "Next due" from the date on your license.',
    source: 'https://gaming.ny.gov/lottery-licensing',
  },
  {
    key: 'sales-tax-coa', name: 'Sales tax Certificate of Authority', category: 'licenses', every: '', unit: 'years',
    who: 'Owner', agency: 'NYS Tax Department', record: 'Certificate, displayed',
    notes: 'Renew when the Tax Department sends an expiration notice (at least 120 days ahead). Set "Next due" from that notice.',
    source: 'https://regulations.justia.com/states/new-york/title-20/chapter-iv/subchapter-a/part-540/section-540-6/',
  },
  {
    key: 'local-permits', name: 'Village / Fire Marshal permits (confirm)', category: 'licenses', every: 1, unit: 'years',
    who: 'Owner', agency: 'Village of Farmingdale / Nassau Fire Marshal', record: 'Permits and inspection reports',
    notes: 'Not confirmed. Nassau lists an annual fire safety inspection fee for certain businesses. Ask the Village Building Department and the Fire Marshal what applies, then set the dates or remove this item.',
    source: 'https://www.nassaucountyny.gov/408/Fire-Marshal-Fees',
  },
  // ---- Fire & safety ----
  {
    key: 'extinguisher-annual', name: 'Fire extinguisher annual service', category: 'safety', every: 1, unit: 'years',
    who: 'Licensed extinguisher company', agency: 'Fire code (NFPA 10)', record: 'Service tag on each extinguisher',
    notes: 'Monthly visual checks are on the monthly checklist.',
    source: 'https://www.nfpa.org/codes-and-standards/nfpa-10-standard-development/10',
  },
  {
    key: 'extinguisher-6yr', name: 'Fire extinguisher 6-year maintenance / 12-year hydro test', category: 'safety', every: 6, unit: 'years',
    who: 'Licensed extinguisher company', agency: 'Fire code (NFPA 10)', record: 'Service tag / collar',
    notes: 'For dry chemical extinguishers: internal maintenance every 6 years and a hydrostatic test every 12. Set "Next due" from the extinguisher tags.',
    source: 'https://www.nfpa.org/codes-and-standards/nfpa-10-standard-development/10',
  },
];

// Checklists done by station staff. Inventory readings, water and the 10-day reconciliation
// themselves are recorded on the daily entry; these confirm the checks were done.
export const CHECKLISTS = {
  daily: {
    label: 'Daily',
    title: 'Daily station check',
    summary: 'Each operating day: readings, alarms, dispensers and price signs.',
    intro: 'Each operating day (6 NYCRR 613-2.3(c)(1), Nassau Article XV 15-2.3(c)(1)). Readings and water go on the daily entry; this confirms the checks were done.',
    items: [
      { key: 'readings', text: 'Tank inventory readings taken and recorded for every tank (to 1/8 inch)', hint: 'Entered on the daily report' },
      { key: 'water', text: 'Water at the bottom of each tank measured and recorded (to 1/8 inch)' },
      { key: 'alarms', text: 'TLS-350 shows no active alarms or warnings', hint: 'Report a leak alarm to the DEC Spill Hotline (1-800-457-7362) and NCDOH within 2 hours' },
      { key: 'delivery', text: 'Any delivery: right tank, enough room, couplings tight, spill bucket empty before and after; readings before and after compared with the delivery ticket', hint: 'N/A if there was no delivery' },
      { key: 'dispensers', text: 'Hoses, nozzles and breakaways: no leaks, cracks or damage' },
      { key: 'signs', text: 'Price signs on every dispenser readable from the driveway, with both cash and credit prices posted' },
    ],
  },
  weekly: {
    label: 'Weekly',
    title: 'Weekly tank system inspection',
    summary: 'Nassau County requires a weekly inspection and leak-detection log, done by a Class B operator.',
    intro: 'Weekly, by a Class B operator (Nassau Article XV 15-2.2(a)(7) and 15-2.3(b); 6 NYCRR 613-2.3(b)(1)). Keep this log on site for 3 years.',
    items: [
      { key: 'tank-interstitial', text: 'Leak detection between the tank walls: every tank sensor normal on the TLS-350', hint: 'Print or note the TLS sensor status report' },
      { key: 'piping', text: 'Piping leak detection working: line leak detectors and sump sensors normal' },
      { key: 'monitoring', text: 'Monitoring system working: all probes and sensors communicating, no out-of-service devices' },
      { key: 'high-level', text: 'High-level (overfill) alarms working' },
      { key: 'gauges-valves', text: 'Gauges and valves in good condition and working' },
      { key: 'pumps', text: 'Submersible pumps: no leaks, unusual noise or alarms' },
      { key: 'spill-equipment', text: 'Spill buckets / catch basins clean, dry and undamaged; fill caps secure' },
    ],
  },
  monthly: {
    label: 'Monthly',
    title: 'Monthly (30-day) walkthrough inspection',
    summary: 'The every-30-days walkthrough required by 6 NYCRR 613-2.2(h), plus extinguishers and spill kit.',
    intro: 'At least every 30 days (6 NYCRR 613-2.2(g)(1) and (h)(1)(i)(a)). Keep this record for 3 years.',
    items: [
      { key: 'spill-buckets', text: 'Spill buckets / catch basins: checked for damage, liquid and debris removed, no drop-tube obstructions, fill caps secure', hint: 'If double-walled, check the space between the walls for liquid' },
      { key: 'rd-equipment', text: 'Leak detection equipment running with no alarms or unusual conditions' },
      { key: 'rd-records', text: 'Leak detection records reviewed and current; the last 30 days available on site' },
      { key: 'connectivity', text: 'Every TLS-350 probe and sensor communicating (electronic connectivity check)' },
      { key: 'recon', text: 'This month\'s 10-day reconciliations finished and reviewed; any over the limit investigated', hint: 'See 10-day reconciliation' },
      { key: 'extinguishers', text: 'Fire extinguishers: in place, charged (gauge in the green), seal intact, tag initialed' },
      { key: 'spill-kit', text: 'Spill kit stocked; emergency fuel shutoff accessible and labeled "EMERGENCY FUEL SHUTOFF"' },
    ],
  },
  annual: {
    label: 'Annual',
    title: 'Annual walkthrough inspection',
    summary: 'Yearly walkthrough of the sumps and hand-held equipment (6 NYCRR 613-2.2(h)), plus paperwork.',
    intro: 'Once a year (6 NYCRR 613-2.2(h)(1)(i)(b)). Contractor tests (leak detection, Nassau 2-year test, spill buckets) are tracked on the Compliance calendar.',
    items: [
      { key: 'sumps', text: 'Containment sumps (tank top and dispenser): checked for damage and leaks, liquid and debris removed', hint: 'If double-walled, check the space between the walls' },
      { key: 'gauge-stick', text: 'Gauge stick (if used) usable, with readable markings' },
      { key: 'class-c', text: 'Every cashier who works alone is trained as a Class C operator, with the training log up to date' },
      { key: 'insurance', text: 'Proof of tank pollution insurance current and on file' },
      { key: 'certificates', text: 'Tank registration certificate, licenses and permits current and displayed' },
      { key: 'records', text: 'Records from the last 3 years kept and retrievable within 3 business days' },
    ],
  },
};
