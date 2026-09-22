/**
 * Healthians Synthetic Dataset Generator
 *
 * Generates 21 CSV files for the Healthians at-home diagnostics platform demo.
 * Date range: Apr 2024 – May 2026 (26 months)
 * All distributions grounded in real Indian diagnostics epidemiology.
 *
 * Tables:
 *   1.  customers.csv                (~35,284 rows)
 *   2.  customer_addresses.csv       (~49,400 rows, 1.4 per customer)
 *   3.  customer_family_members.csv  (~21,876 rows, 0.62 per customer)
 *   4.  customer_lifestyle_profiles.csv (~35,284 rows, 1:1)
 *   5.  phlebotomists.csv            (~540 rows, derived)
 *   6.  bookings.csv                 (derived from archetype simulation)
 *   7.  booking_items.csv            (~1.05 per booking)
 *   8.  phlebotomist_assignments.csv (1:1 with non-cancelled/non-no_show)
 *   9.  sample_tracking.csv          (1:1 with assignments where no_show=false)
 *  10.  reports.csv                  (1:1 with accepted samples)
 *  11.  report_results.csv           (expanded parameters — big table)
 *  12.  counseling_sessions.csv      (~18% of bookings)
 *  13.  report_future_tests.csv      (driven by abnormal results)
 *  14.  subscriptions.csv            (~11% of customers)
 *  15.  subscription_runs.csv        (expand over time)
 *  16.  comms_log.csv                (CRM messages, derived from lifecycle)
 *  17.  nps_responses.csv            (~30% of bookings)
 *  18.  phlebotomist_ratings.csv     (~60% of bookings)
 *  19.  support_tickets.csv          (~4% of bookings)
 *  20.  leads.csv                    (12% of web bookings)
 *  21.  user_events.csv              (event log — streaming)
 *
 * Usage: npx tsx scripts/generate-healthians.ts
 * Seed: 42 (deterministic, reproduces identical output every run)
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const OUT_DIR = resolve(__dirname, "../data/csv/healthians");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════════
// SEEDED PRNG (LCG — identical to fundsindia/quickhelp pattern)
// ════════════════════════════════════════════════════════════════

let _seed = 42;
function rand(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function normalRand(mean: number, std: number): number {
  const u1 = rand() || 0.0001;
  const u2 = rand();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function logNormalRand(logmu: number, logsigma: number): number {
  return Math.exp(normalRand(logmu, logsigma));
}
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
function roundTo(val: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(val * f) / f;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ════════════════════════════════════════════════════════════════

const DATE_START = "2024-04-01";
const DATE_END   = "2026-05-26";

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
function diffMonths(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}
function getMonth(date: string): number { return new Date(date).getMonth() + 1; }
function getYear(date: string): number  { return new Date(date).getFullYear(); }
function monthKey(date: string): string { return date.slice(0, 7); }
function randomDateInMonth(y: number, m: number): string {
  return dateStr(y, m, randInt(1, daysInMonth(y, m)));
}
function randomDateBetween(start: string, end: string): string {
  const days = diffDays(start, end);
  return addDays(start, randInt(0, Math.max(0, days)));
}
function allMonths(start: string, end: string): [number, number][] {
  const months: [number, number][] = [];
  let y = getYear(start), m = getMonth(start);
  const ey = getYear(end), em = getMonth(end);
  while (y < ey || (y === ey && m <= em)) {
    months.push([y, m]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}
function dayOfWeek(date: string): number {
  return new Date(date).getDay(); // 0=Sun, 6=Sat
}
function tsStr(date: string, hour: number, minute: number, second = 0): string {
  return `${date} ${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:${String(second).padStart(2,"0")}`;
}
function addMinutes(ts: string, minutes: number): string {
  const d = new Date(ts.replace(" ", "T"));
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
function addHours(ts: string, hours: number): string {
  return addMinutes(ts, hours * 60);
}

// Seasonal booking multiplier
function bookingSeasonMultiplier(month: number): number {
  const m: Record<number, number> = {
    1: 1.3, 2: 1.5, 3: 1.7,
    4: 1.0, 5: 0.95, 6: 1.0,
    7: 1.4, 8: 1.6, 9: 1.3,
    10: 1.1, 11: 1.2, 12: 1.0,
  };
  return m[month] ?? 1.0;
}

// ════════════════════════════════════════════════════════════════
// CSV WRITERS
// ════════════════════════════════════════════════════════════════

function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(","))
  ];
  writeFileSync(resolve(OUT_DIR, filename), lines.join("\n") + "\n");
  console.log(`  ✓ ${filename}: ${rows.length.toLocaleString()} rows`);
}

function writeCsvHeader(filename: string, headers: string[]) {
  writeFileSync(resolve(OUT_DIR, filename), headers.join(",") + "\n");
}
function writeCsvChunk(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const lines = rows.map(r => headers.map(h => escape(r[h])).join(","));
  appendFileSync(resolve(OUT_DIR, filename), lines.join("\n") + "\n");
}

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════

const N_CUSTOMERS = 35_284;
const SEED = 42;

// Customer archetypes
const ARCHETYPES = {
  chronic_subscriber: { pct: 0.11, bookings_per_year_mu: 7.8, bookings_per_year_sigma: 1.4, counseling_uptake: 0.54, churn_monthly: 0.003 },
  annual_checker:     { pct: 0.28, bookings_per_year_mu: 1.2, bookings_per_year_sigma: 0.4, tax_season_mult: 1.8,    counseling_uptake: 0.09, churn_monthly: 0.04 },
  reactive_booker:    { pct: 0.21, bookings_per_year_mu: 1.8, bookings_per_year_sigma: 0.9, counseling_uptake: 0.12, churn_monthly: 0.08 },
  health_anxious:     { pct: 0.08, bookings_per_year_mu: 5.1, bookings_per_year_sigma: 1.8, abnormal_rebooking_mult: 3.2, counseling_uptake: 0.71, churn_monthly: 0.005 },
  doctor_referred:    { pct: 0.12, bookings_per_year_mu: 2.4, bookings_per_year_sigma: 0.8, prescription_driven: 0.78, counseling_uptake: 0.25, churn_monthly: 0.02 },
  one_and_done:       { pct: 0.20, bookings_per_year_mu: 0.95, bookings_per_year_sigma: 0.1, all_normal_prob: 0.71, counseling_uptake: 0.03, churn_monthly: 0.25 },
};
type ArchetypeKey = keyof typeof ARCHETYPES;

// City data
interface CityDef {
  city: string;
  state: string;
  tier: "metro" | "tier1" | "tier2";
  hub_id: string;
  localities: string[];
}

const CITIES: CityDef[] = [
  // Metro
  { city: "Bengaluru",    state: "Karnataka",       tier: "metro", hub_id: "HUB_BLR", localities: ["Koramangala","HSR Layout","Indiranagar","Whitefield","Sarjapura","Marathahalli","Jayanagar","Rajajinagar","Bannerghatta Road","Electronic City"] },
  { city: "Chennai",      state: "Tamil Nadu",      tier: "metro", hub_id: "HUB_CHN", localities: ["Anna Nagar","T Nagar","Adyar","Velachery","Tambaram","Porur","Perambur","Nungambakkam","Madipakkam","Sholinganallur"] },
  { city: "Delhi",        state: "Delhi",           tier: "metro", hub_id: "HUB_DEL", localities: ["Lajpat Nagar","Dwarka","Rohini","Pitampura","Janakpuri","Karol Bagh","Saket","Vasant Kunj","Rajouri Garden","Hauz Khas"] },
  { city: "Gurgaon",      state: "Haryana",         tier: "metro", hub_id: "HUB_GUR", localities: ["DLF Phase 1","Sector 14","Sushant Lok","Golf Course Road","Palam Vihar","South City","Unitech Cyber Park","Sector 56","New Colony","Bhim Nagar"] },
  { city: "Hyderabad",    state: "Telangana",       tier: "metro", hub_id: "HUB_HYD", localities: ["Banjara Hills","Jubilee Hills","Madhapur","Kondapur","Gachibowli","Kukatpally","LB Nagar","Secunderabad","KPHB","Ameerpet"] },
  { city: "Kolkata",      state: "West Bengal",     tier: "metro", hub_id: "HUB_KOL", localities: ["Salt Lake","Park Street","Tollygunge","Behala","Dum Dum","New Town","Jadavpur","Ballygunge","Sreebhumi","Kasba"] },
  { city: "Mumbai",       state: "Maharashtra",     tier: "metro", hub_id: "HUB_MUM", localities: ["Andheri West","Bandra West","Powai","Thane","Kandivali","Malad","Goregaon","Borivali","Chembur","Kurla"] },
  { city: "Noida",        state: "Uttar Pradesh",   tier: "metro", hub_id: "HUB_NOI", localities: ["Sector 18","Sector 62","Sector 50","Sector 76","Greater Noida West","Sector 137","Sector 100","Sector 44","Sector 29","Sector 15"] },
  { city: "Pune",         state: "Maharashtra",     tier: "metro", hub_id: "HUB_PUN", localities: ["Kothrud","Baner","Wakad","Hinjewadi","Aundh","Viman Nagar","Kharadi","Hadapsar","Deccan","Pimpri"] },
  // Tier 1
  { city: "Ahmedabad",    state: "Gujarat",         tier: "tier1", hub_id: "HUB_AMD", localities: ["Navrangpura","Satellite","Vastrapur","Bopal","Chandkheda","Thaltej","Maninagar","Naranpura","Gota","Prahlad Nagar"] },
  { city: "Amritsar",     state: "Punjab",          tier: "tier1", hub_id: "HUB_ATQ", localities: ["Lawrence Road","GT Road","Ranjit Avenue","Sultanwind","Majitha Road","Mall Road","Queens Road","Green Avenue","Model Town","Sadar Bazar"] },
  { city: "Bhopal",       state: "Madhya Pradesh",  tier: "tier1", hub_id: "HUB_BPL", localities: ["MP Nagar","Arera Colony","TT Nagar","Kolar Road","Govindpura","Bairagarh","Shahpura","Piplani","Gulmohar","New Market"] },
  { city: "Chandigarh",   state: "Punjab",          tier: "tier1", hub_id: "HUB_IXC", localities: ["Sector 17","Sector 22","Sector 34","Sector 43","Sector 8","Sector 15","Manimajra","Sector 40","Sector 35","Sector 26"] },
  { city: "Indore",       state: "Madhya Pradesh",  tier: "tier1", hub_id: "HUB_IDR", localities: ["Vijay Nagar","Palasia","Scheme 54","Bhawarkuan","Rau","LIG Colony","South Tukoganj","Rajendra Nagar","Banganga","AB Road"] },
  { city: "Jaipur",       state: "Rajasthan",       tier: "tier1", hub_id: "HUB_JAI", localities: ["Vaishali Nagar","Malviya Nagar","C-Scheme","Raja Park","Mansarovar","Jagatpura","Tonk Road","Sitapura","Sanganer","Pratap Nagar"] },
  { city: "Kanpur",       state: "Uttar Pradesh",   tier: "tier1", hub_id: "HUB_KNU", localities: ["Swaroop Nagar","Kakadeo","Civil Lines","Kidwai Nagar","Govind Nagar","Armapur","Kalyanpur","Barra","Vikas Nagar","Fazalganj"] },
  { city: "Lucknow",      state: "Uttar Pradesh",   tier: "tier1", hub_id: "HUB_LKO", localities: ["Gomti Nagar","Hazratganj","Aliganj","Indira Nagar","Alambagh","Rajajipuram","Mahanagar","Chinhat","Vikas Nagar","Nirala Nagar"] },
  { city: "Ludhiana",     state: "Punjab",          tier: "tier1", hub_id: "HUB_LUH", localities: ["Model Town","Sarabha Nagar","Dugri","BRS Nagar","Rajguru Nagar","Pakhowal Road","Haibowal","Ferozepur Road","Ghumar Mandi","Civil Lines"] },
  { city: "Nagpur",       state: "Maharashtra",     tier: "tier1", hub_id: "HUB_NAG", localities: ["Dharampeth","Ramdaspeth","Sadar","Sitabuldi","Manewada","Hingna","Pratap Nagar","Nandanvan","Trimurti Nagar","Lakadganj"] },
  { city: "Nashik",       state: "Maharashtra",     tier: "tier1", hub_id: "HUB_ISK", localities: ["Gangapur Road","Cidco","Satpur","Panchvati","Deolali Camp","Dwarka","Trimbak Road","College Road","Indira Nagar","Ambad"] },
  { city: "Patna",        state: "Bihar",           tier: "tier1", hub_id: "HUB_PAT", localities: ["Boring Road","Kankarbagh","Rajendra Nagar","Bailey Road","Danapur","Ashok Raj Path","Kadamkuan","Patna City","Saguna More","Phulwari Sharif"] },
  { city: "Surat",        state: "Gujarat",         tier: "tier1", hub_id: "HUB_STV", localities: ["Adajan","Vesu","Piplod","Athwa","Varachha","Katargam","Udhna","Dindoli","Althan","Bhatar"] },
  { city: "Vadodara",     state: "Gujarat",         tier: "tier1", hub_id: "HUB_BDQ", localities: ["Alkapuri","Fatehgunj","Vasna","Manjalpur","Gotri","Karelibaug","Waghodia Road","Makarpura","Harni","Sama"] },
  { city: "Varanasi",     state: "Uttar Pradesh",   tier: "tier1", hub_id: "HUB_VNS", localities: ["Sigra","Lanka","Assi","Cantonment","Shivpur","Sunderpur","BHU","Nadesar","Pandeypur","Lahurabir"] },
  { city: "Vijayawada",   state: "Andhra Pradesh",  tier: "tier1", hub_id: "HUB_VGA", localities: ["Benz Circle","Governorpet","Suryaraopet","Moghalrajpuram","Vijaya Nagar Colony","Ajit Singh Nagar","Gunadala","Vambay Colony","MG Road","One Town"] },
  { city: "Visakhapatnam",state: "Andhra Pradesh",  tier: "tier1", hub_id: "HUB_VTZ", localities: ["Dwaraka Nagar","Seethammadhara","MVP Colony","Gajuwaka","Madhurawada","Rushikonda","Steel Plant","NAD Junction","Siripuram","Akkayyapalem"] },
  // Tier 2
  { city: "Agra",         state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_AGR", localities: ["Shahganj","Civil Lines","Sanjay Place","Kamla Nagar","Tajganj","Sikandra","Bodla","Fatehabad Road","Trans Yamuna","Pratapnagar"] },
  { city: "Aligarh",      state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_IGR", localities: ["Civil Lines","Ramghat Road","Marris Road","Sasni Gate","Jamal Nagar","Quarsi","Bannadevi","Medical Road","Dodhpur","NH-91 Road"] },
  { city: "Allahabad",    state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_IXD", localities: ["Civil Lines","George Town","Alopi Bagh","Kydganj","Mumfordganj","Lukerganj","Jhusi","Naini","Tagore Town","Zero Road"] },
  { city: "Bareilly",     state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_BEK", localities: ["Civil Lines","Pilibhit Bypass","Subhash Nagar","Nawabganj","Cantt","Ram Ganga Vihar","Izatnagar","Faridpur","Kutubkhana","Badaun Road"] },
  { city: "Dehradun",     state: "Uttarakhand",     tier: "tier2", hub_id: "HUB_DED", localities: ["Rajpur Road","Clement Town","Karanpur","Dalanwala","Ballupur","Dhoolkot","Sahastradara","Niranjanpur","Prem Nagar","GMS Road"] },
  { city: "Gwalior",      state: "Madhya Pradesh",  tier: "tier2", hub_id: "HUB_GWL", localities: ["Morar","City Centre","Gole Ka Mandir","Lashkar","Thatipur","Shivpuri Link Road","Hazira","Padav","Gandhi Road","Bajrangpura"] },
  { city: "Jodhpur",      state: "Rajasthan",       tier: "tier2", hub_id: "HUB_JDH", localities: ["Sardarpura","Residency Road","Shastri Nagar","Paota","Ratanada","Pal","Chopasni Housing Board","Umed Hospital Road","Bhati Circle","Mandor"] },
  { city: "Kota",         state: "Rajasthan",       tier: "tier2", hub_id: "HUB_KTU", localities: ["Talwandi","Vigyan Nagar","Mahaveer Nagar","Nayapura","Kunhari","Dadabari","Gumanpura","Rangbari","Indraprastha","Aerodrome Circle"] },
  { city: "Meerut",       state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_IXR", localities: ["Civil Lines","Shastri Nagar","Ganga Nagar","Saket","Bachha Park","Hapur Road","Modipuram","Lisari Gate","Shyam Nagar","Mangalayatan"] },
  { city: "Gorakhpur",    state: "Uttar Pradesh",   tier: "tier2", hub_id: "HUB_GOP", localities: ["Golghar","Medical College Road","Dharamshala Bazar","Taramandal","Betiahata","Padrauna Road","Sahjanwa","Civil Lines","Shahpur","Basharatpur"] },
  { city: "Ranchi",       state: "Jharkhand",       tier: "tier2", hub_id: "HUB_IXR2", localities: ["Harmu","Lalpur","Doranda","Ashok Nagar","Ratu Road","Kanke Road","Bariatu","Burdwan Compound","Main Road","Morabadi"] },
  { city: "Raipur",       state: "Chhattisgarh",    tier: "tier2", hub_id: "HUB_RPR", localities: ["Pandri","Devendra Nagar","Tatibandh","Shankar Nagar","Civil Lines","VIP Estate","Avanti Vihar","Pachpedi Naka","Telibandha","Fafadih"] },
  { city: "Bhubaneswar",  state: "Odisha",          tier: "tier2", hub_id: "HUB_BBI", localities: ["Saheed Nagar","Nayapalli","Patia","Chandrasekharpur","Khandagiri","Damana","Tamando","IRC Village","Pokhariput","Jayadev Vihar"] },
  { city: "Udaipur",      state: "Rajasthan",       tier: "tier2", hub_id: "HUB_UDR", localities: ["Hiran Magri","Shobhagpura","Sukhadia Circle","Fateh Sagar","Patel Circle","Pratap Nagar","Madhuban","Chetak Circle","Balicha","Ambamata"] },
  { city: "Rajkot",       state: "Gujarat",         tier: "tier2", hub_id: "HUB_RAJ", localities: ["Kalawad Road","Mavdi","Gondal Road","Kothariya","University Road","Raiya Road","Bhaktinagar","Sadhuvasvani Road","Aji Dam Road","150 Ft Ring Road"] },
  { city: "Guwahati",     state: "Assam",           tier: "tier2", hub_id: "HUB_GAU", localities: ["Paltan Bazar","Fancy Bazar","Dispur","Geetanagar","Beltola","Kahilipara","Bharalumukh","Silpukhuri","Ulubari","Christian Basti"] },
];

// Hub IDs
const ALL_HUB_IDS = Array.from(new Set(CITIES.map(c => c.hub_id)));

// Indian names
const MALE_NAMES_HINDI = ["Rahul","Amit","Vijay","Rajesh","Sanjay","Suresh","Anil","Ravi","Kiran","Deepak","Pradeep","Ramesh","Ashok","Vinod","Manoj","Sandeep","Nitin","Rohit","Vikas","Arjun","Nikhil","Akash","Harsh","Dev","Rishabh"];
const MALE_NAMES_SOUTH = ["Suresh","Rajan","Ganesh","Venkat","Prasad","Murugan","Selvam","Balaji","Kartik","Ramesh","Krishna","Srinivas","Anand","Vijay","Senthil","Mohan","Arun","Karthikeyan","Dinesh","Lokesh"];
const MALE_NAMES_BENGALI = ["Arnab","Suvajit","Debashish","Pritam","Souvik","Anirban","Subhrajit","Tanmoy","Soumya","Ayan","Bhaskar","Saikat","Dipankar","Rittick","Koushik"];
const MALE_NAMES_PUNJABI = ["Gurpreet","Harjinder","Kulwinder","Manpreet","Paramjit","Rajinder","Sandeep","Sukhwinder","Taranjit","Hardeep","Jaswinder","Balwinder","Amritpal","Navdeep","Gagandeep"];
const ALL_MALE_NAMES = [...MALE_NAMES_HINDI, ...MALE_NAMES_SOUTH, ...MALE_NAMES_BENGALI, ...MALE_NAMES_PUNJABI];

const FEMALE_NAMES_HINDI = ["Priya","Sunita","Anjali","Rekha","Kavita","Meena","Pooja","Neha","Swati","Sneha","Asha","Divya","Anita","Seema","Ritu","Shweta","Nidhi","Pallavi","Shilpa","Deepa","Aarti","Preeti","Nisha","Sonal","Kratika"];
const FEMALE_NAMES_SOUTH = ["Lakshmi","Padmavathi","Revathi","Sangeetha","Nithya","Kavitha","Meenakshi","Saranya","Deepika","Anuradha","Sowmya","Vijayalakshmi","Shanthi","Archana","Lavanya"];
const FEMALE_NAMES_BENGALI = ["Puja","Suchismita","Priyanka","Moumita","Ishita","Shreyasi","Deblina","Srabanti","Antara","Sayantani","Paramita","Susmita","Rupali","Suchandra","Pritha"];
const FEMALE_NAMES_PUNJABI = ["Simran","Harpreet","Gurpreet","Manpreet","Jaspreet","Navneet","Sukhpreet","Amarjot","Ramandeep","Navjot","Gurleen","Harleen","Manjot","Kirandeep","Parminder"];
const ALL_FEMALE_NAMES = [...FEMALE_NAMES_HINDI, ...FEMALE_NAMES_SOUTH, ...FEMALE_NAMES_BENGALI, ...FEMALE_NAMES_PUNJABI];

const LAST_NAMES = ["Sharma","Verma","Singh","Patel","Kumar","Gupta","Joshi","Shah","Mehta","Rao","Nair","Reddy","Iyer","Pillai","Menon","Tiwari","Mishra","Pandey","Sinha","Das","Bose","Chatterjee","Banerjee","Mukherjee","Ghosh","Agarwal","Jain","Malhotra","Khanna","Chopra","Kaur","Gill","Sandhu","Grewal","Sethi","Bhatt","Kapoor","Arora","Mathur","Bajaj","Krishnamurthy","Subramaniam","Venkataraman","Narayanan","Sundaram","Ramamurthy","Thyagarajan","Chakraborty","Bhattacharya","Sengupta","Mukhopadhyay","Ganguly","Bhaduri","Dasgupta"];

function fullName(gender: string): string {
  const first = gender === "male" ? pick(ALL_MALE_NAMES) : pick(ALL_FEMALE_NAMES);
  return `${first} ${pick(LAST_NAMES)}`;
}

// Test catalog
interface TestDef {
  slug: string;
  name: string;
  category: string;
  params_count: number;
  list_price_inr: number;
  parameters: string[];
}

const TEST_CATALOG: TestDef[] = [
  { slug: "full_body",     name: "Healthy India 2026 Full Body Checkup Lite",     category: "full_body",     params_count: 80, list_price_inr: 1046, parameters: ["Haemoglobin","TLC","Platelet Count","RBC","MCV","MCH","MCHC","HCT","TSH Ultra-Sensitive","T3 Total","T4 Total","Blood Glucose Fasting","HbA1c","Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","SGPT/ALT","SGOT/AST","GGTP","Alkaline Phosphatase","Albumin","Bilirubin Total","Total Protein","Creatinine","BUN","Urea","Uric Acid","Sodium","Potassium","Vitamin D","Vitamin B12"] },
  { slug: "full_body_basic", name: "Make India Healthy Package 2026",            category: "full_body",     params_count: 7,  list_price_inr: 99,   parameters: ["Haemoglobin","Blood Glucose Fasting","Cholesterol Total","Creatinine","TSH Ultra-Sensitive","Vitamin D","Vitamin B12"] },
  { slug: "thyroid",       name: "Thyroid Package Preventive",                   category: "thyroid",       params_count: 12, list_price_inr: 487,  parameters: ["TSH Ultra-Sensitive","T3 Total","T4 Total","FT3","FT4"] },
  { slug: "thyroid_tsh",   name: "TSH Ultra Sensitive",                          category: "thyroid",       params_count: 1,  list_price_inr: 334,  parameters: ["TSH Ultra-Sensitive"] },
  { slug: "hba1c",         name: "HbA1c",                                         category: "diabetes",      params_count: 2,  list_price_inr: 360,  parameters: ["HbA1c","Blood Glucose Fasting"] },
  { slug: "cbc",           name: "Complete Hemogram",                             category: "hematology",    params_count: 25, list_price_inr: 390,  parameters: ["Haemoglobin","TLC","Platelet Count","RBC","MCV","MCH","MCHC","HCT"] },
  { slug: "diabetes_checkup", name: "Healthians Diabetic Checkup",               category: "diabetes",      params_count: 44, list_price_inr: 840,  parameters: ["HbA1c","Blood Glucose Fasting","Creatinine","BUN","Urea","Uric Acid","Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","SGPT/ALT","Albumin"] },
  { slug: "liver",         name: "Liver Function Test",                           category: "liver",         params_count: 12, list_price_inr: 379,  parameters: ["SGPT/ALT","SGOT/AST","GGTP","Alkaline Phosphatase","Albumin","Bilirubin Total","Total Protein"] },
  { slug: "kidney",        name: "Kidney Function Test Advance",                  category: "kidney",        params_count: 11, list_price_inr: 427,  parameters: ["Creatinine","BUN","Urea","Uric Acid","Sodium","Potassium"] },
  { slug: "lipid",         name: "Lipid Profile Advance",                        category: "cardiac",       params_count: 9,  list_price_inr: 497,  parameters: ["Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides"] },
  { slug: "vitamin_d",     name: "Vitamin D Total-25 Hydroxy",                   category: "vitamins",      params_count: 1,  list_price_inr: 440,  parameters: ["Vitamin D"] },
  { slug: "vitamin_b12",   name: "Vitamin B12 Cyanocobalamin",                   category: "vitamins",      params_count: 1,  list_price_inr: 571,  parameters: ["Vitamin B12"] },
  { slug: "dengue",        name: "Dengue Test",                                   category: "fever",         params_count: 3,  list_price_inr: 656,  parameters: ["TLC","Platelet Count"] },
  { slug: "fever",         name: "Healthians Extended Fever Package",             category: "fever",         params_count: 58, list_price_inr: 1914, parameters: ["Haemoglobin","TLC","Platelet Count","RBC","SGPT/ALT","SGOT/AST","Creatinine","Blood Glucose Fasting"] },
  { slug: "typhoid",       name: "Typhoid Test",                                  category: "fever",         params_count: 29, list_price_inr: 459,  parameters: ["TLC","Platelet Count","Haemoglobin"] },
  { slug: "cardiac",       name: "Cardiac Health Assessment Package",             category: "cardiac",       params_count: 24, list_price_inr: 1426, parameters: ["Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","hsCRP","Blood Glucose Fasting","SGPT/ALT","Creatinine"] },
  { slug: "cancer_female", name: "Cancer Screening Female",                      category: "cancer",        params_count: 3,  list_price_inr: 699,  parameters: ["Haemoglobin","TLC","Albumin"] },
  { slug: "cancer_male",   name: "Cancer Screening Male",                        category: "cancer",        params_count: 3,  list_price_inr: 699,  parameters: ["Haemoglobin","TLC","Albumin"] },
  { slug: "pcos",          name: "Healthians PCOD Panel Package",                 category: "hormones",      params_count: 15, list_price_inr: 890,  parameters: ["TSH Ultra-Sensitive","T3 Total","T4 Total","Blood Glucose Fasting","Cholesterol Total","Iron","Ferritin"] },
  { slug: "pregnancy",     name: "Advanced Antenatal Care",                      category: "pregnancy",     params_count: 72, list_price_inr: 2170, parameters: ["Haemoglobin","TLC","Platelet Count","Blood Glucose Fasting","TSH Ultra-Sensitive","Iron","Ferritin","Vitamin D","Vitamin B12","Creatinine"] },
  { slug: "kids",          name: "Healthians Kids Special Package",               category: "pediatric",     params_count: 49, list_price_inr: 979,  parameters: ["Haemoglobin","TLC","Platelet Count","Blood Glucose Fasting","Vitamin D","Vitamin B12","Iron","Calcium Total"] },
  { slug: "teen_girls",    name: "Teen Girls Health Package 12-18",               category: "pediatric",     params_count: 88, list_price_inr: 2084, parameters: ["Haemoglobin","TLC","Iron","Ferritin","Vitamin D","Vitamin B12","TSH Ultra-Sensitive","Blood Glucose Fasting"] },
  { slug: "senior_male",   name: "Senior Men Health Package 60+",                 category: "senior",        params_count: 97, list_price_inr: 3703, parameters: ["Haemoglobin","TLC","Platelet Count","Blood Glucose Fasting","HbA1c","Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","Creatinine","BUN","Uric Acid","SGPT/ALT","SGOT/AST","TSH Ultra-Sensitive","Vitamin D","Vitamin B12","Sodium","Potassium","Calcium Total"] },
  { slug: "senior_female", name: "Senior Women Health Package 60+",               category: "senior",        params_count: 93, list_price_inr: 3421, parameters: ["Haemoglobin","TLC","Platelet Count","Blood Glucose Fasting","HbA1c","Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","Creatinine","BUN","Uric Acid","SGPT/ALT","TSH Ultra-Sensitive","T3 Total","T4 Total","FT3","FT4","Vitamin D","Vitamin B12","Iron","Ferritin","Sodium","Potassium","Calcium Total"] },
  { slug: "smoking",       name: "Smoking Effect Screening",                     category: "lifestyle",     params_count: 65, list_price_inr: 2334, parameters: ["Haemoglobin","TLC","Platelet Count","SGPT/ALT","SGOT/AST","Creatinine","Cholesterol Total","HDL Cholesterol","Triglycerides","hsCRP"] },
  { slug: "obesity",       name: "Obesity Review Package",                       category: "lifestyle",     params_count: 52, list_price_inr: 1283, parameters: ["Blood Glucose Fasting","HbA1c","Cholesterol Total","HDL Cholesterol","LDL Cholesterol","Triglycerides","TSH Ultra-Sensitive","Vitamin D","hsCRP","Uric Acid"] },
  { slug: "hair_female",   name: "Hair Care Female Advance",                     category: "lifestyle",     params_count: 59, list_price_inr: 8876, parameters: ["Iron","Ferritin","Vitamin D","Vitamin B12","TSH Ultra-Sensitive","T3 Total","T4 Total","Haemoglobin","Calcium Total","Blood Glucose Fasting"] },
  { slug: "dna",           name: "MyGenome Comprehensive DNA",                   category: "genomics",      params_count: 51, list_price_inr: 6999, parameters: ["Haemoglobin","Blood Glucose Fasting","Vitamin D","Vitamin B12"] },
  { slug: "glp1",          name: "GLP-1 Post-Medication Basic",                  category: "lifestyle",     params_count: 71, list_price_inr: 4262, parameters: ["Blood Glucose Fasting","HbA1c","Creatinine","BUN","Sodium","Potassium","SGPT/ALT","Cholesterol Total","Triglycerides","TSH Ultra-Sensitive"] },
];

const testBySlug = new Map(TEST_CATALOG.map(t => [t.slug, t]));

// Payment methods for bookings
const PAYMENT_METHODS = ["phonePe_upi","upi_wallet_netbanking","mobikwik","cash_on_collection","card"];
const PAYMENT_WEIGHTS = [0.42, 0.28, 0.10, 0.08, 0.12];

const BOOKING_CHANNELS = ["app_android","app_ios","web_self_serve","web_callback","phone_inbound","whatsapp"];
const BOOKING_CHANNEL_WEIGHTS = [0.48, 0.09, 0.20, 0.08, 0.09, 0.06];

const SLOT_BANDS = ["6-8am","8-10am","10am-12pm","12-2pm","2-4pm","4-6pm"];
const SLOT_BAND_WEIGHTS = [0.28, 0.32, 0.18, 0.10, 0.07, 0.05];

// ════════════════════════════════════════════════════════════════
// STEP 1: CUSTOMERS (~35,284 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 1: Generating customers.csv...");

interface Customer {
  customer_id: string;
  signup_date: string;
  archetype: ArchetypeKey;
  age: number;
  age_group: string;
  gender: string;
  city: string;
  state: string;
  city_tier: string;
  hub_id: string;
  acquisition_channel: string;
  install_platform: string;
  device_model_tier: string;
  first_landing_test_category: string;
  days_to_first_booking: number;
  referrer_customer_id: string | null;
  coupon_used_at_signup: boolean;
  health_goal: string;
  primary_health_concern: string;
  chronic_condition: string;
  family_history: string;
  smoking_status: string;
  alcohol_consumption: string;
  exercise_frequency: string;
  bmi_category: string;
  on_regular_medication: boolean;
  last_doctor_visit_timeframe: string;
  insurance_provider: string | null;
  insurance_linked_to_healthians: boolean;
  family_members_added: number;
  books_primarily_for: string;
  total_bookings: number;
  total_spend_inr: number;
  avg_order_value_inr: number;
  first_booking_date: string | null;
  last_booking_date: string | null;
  days_since_last_booking: number | null;
  most_booked_category: string;
  preferred_slot_band: string;
  preferred_payment_method: string;
  cancellation_rate_pct: number;
  report_view_rate_pct: number;
  counseling_uptake_pct: number;
  subscription_active: boolean;
  vitamin_d_status: string;
  vitamin_b12_status: string;
  thyroid_status: string;
  glucose_status: string;
  cholesterol_status: string;
  hemoglobin_status: string;
  lifetime_abnormal_flags_count: number;
  customer_lifecycle_stage: string;
  ltv_bucket: string;
  nps_category: string;
  push_opt_in: boolean;
  whatsapp_opt_in: boolean;
  is_active: boolean;
}

const ACQ_CHANNELS = ["organic_search","google_ads","meta_ads","referral_friend","whatsapp_share","doctor_referral","other"];
const ACQ_WEIGHTS  = [0.32, 0.26, 0.18, 0.14, 0.06, 0.03, 0.01];

const HEALTH_GOALS = ["preventive_checkup","monitor_chronic","doctor_prescribed","weight_management","fertility_planning","pre_surgery","general_wellness","insurance_requirement"];
const HEALTH_CONCERNS = ["none","diabetes_risk","thyroid_issues","anemia","vitamin_deficiency","cholesterol","kidney_stones","liver_concerns","heart_risk","pcos","fatigue","hair_loss"];
const INSURANCE_PROVIDERS = ["Star Health","HDFC ERGO","ICICI Lombard","Niva Bupa","Aditya Birla Health","National Insurance","New India Assurance","United India"];

function ageGroup(age: number): string {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  if (age < 65) return "55-64";
  return "65+";
}

function chronicForGender(gender: string): string {
  const roll = rand();
  if (gender === "female" && rand() < 0.21) {
    return weightedPick(["pcos","none","thyroid","diabetes","hypertension","multiple"], [0.21, 0.31, 0.18, 0.12, 0.10, 0.08]);
  }
  if (roll < 0.47) return "none";
  if (roll < 0.66) return "diabetes";
  if (roll < 0.83) return "hypertension";
  if (roll < 0.96) return "thyroid";
  return "multiple";
}

const MONTHS = allMonths(DATE_START, DATE_END);
const totalMonthCount = MONTHS.length;

// Track referrer IDs for referral chain (pre-assign customer IDs)
const customerIds = Array.from({ length: N_CUSTOMERS }, (_, i) => `CST_${String(i + 1).padStart(6, "0")}`);

const customers: Customer[] = [];

for (let i = 0; i < N_CUSTOMERS; i++) {
  const customerId = customerIds[i];
  // Signup distributed across date range, weighted toward early months (existing base)
  const signupOffset = rand() < 0.40
    ? randomDateBetween("2022-01-01", "2024-03-31") // pre-period signups (40%)
    : randomDateBetween(DATE_START, DATE_END);

  const archetypeKey = weightedPick(
    Object.keys(ARCHETYPES) as ArchetypeKey[],
    Object.values(ARCHETYPES).map(a => a.pct)
  );
  const archetype = ARCHETYPES[archetypeKey];

  const cityDef = weightedPick(
    CITIES,
    CITIES.map(c => c.tier === "metro" ? 0.38/9 : c.tier === "tier1" ? 0.29/17 : 0.33/15)
  );

  const age = clamp(Math.round(
    weightedPick(
      [21, 30, 40, 50, 60, 68],
      [0.07, 0.26, 0.31, 0.23, 0.10, 0.03]
    ) + normalRand(0, 4)
  ), 18, 75);

  const gender = weightedPick(["male","female","other"], [0.54, 0.44, 0.02]);
  const chronic = chronicForGender(gender);

  const acqChannel = weightedPick(ACQ_CHANNELS, ACQ_WEIGHTS);
  const referrerId = acqChannel === "referral_friend" && i > 100
    ? customerIds[randInt(0, Math.min(i - 1, i - 1))]
    : null;

  const platform = weightedPick(["android","ios","web"], [0.63, 0.22, 0.15]);

  // BMI skewed for India (overweight/obese higher in urban)
  const bmiCat = weightedPick(
    ["underweight","normal","overweight","obese"],
    [0.12, 0.41, 0.32, 0.15]
  );

  const daysToFirstBooking = archetypeKey === "one_and_done"
    ? randInt(1, 7)
    : archetypeKey === "annual_checker"
      ? randInt(3, 30)
      : randInt(1, 21);

  const signupInPeriod = signupOffset >= DATE_START;
  const firstBookingDate = signupInPeriod
    ? addDays(signupOffset, daysToFirstBooking)
    : randomDateBetween(DATE_START, DATE_END);
  const effectiveFirstBooking = firstBookingDate <= DATE_END ? firstBookingDate : null;

  // Lifecycle stage
  const lifecycleStage: string = (() => {
    if (archetypeKey === "one_and_done" && rand() < 0.65) return "churned";
    if (archetypeKey === "chronic_subscriber") return rand() < 0.85 ? "loyal" : "engaged";
    if (!signupInPeriod) return weightedPick(["engaged","loyal","at_risk","churned"], [0.30, 0.25, 0.28, 0.17]);
    return weightedPick(["new","activated","engaged"], [0.25, 0.45, 0.30]);
  })();

  const totalBookings = (() => {
    const base = Math.max(0, Math.round(normalRand(archetype.bookings_per_year_mu, archetype.bookings_per_year_sigma) * (totalMonthCount / 12)));
    if (archetypeKey === "one_and_done") return Math.min(base, 2);
    if (lifecycleStage === "churned") return Math.max(1, Math.round(base * 0.3));
    return base;
  })();

  const avgOV = (() => {
    if (archetypeKey === "chronic_subscriber") return Math.round(normalRand(650, 150));
    if (archetypeKey === "annual_checker") return Math.round(normalRand(900, 250));
    if (archetypeKey === "health_anxious") return Math.round(normalRand(750, 200));
    if (archetypeKey === "doctor_referred") return Math.round(normalRand(600, 180));
    return Math.round(normalRand(700, 200));
  })();

  const totalSpend = totalBookings * clamp(avgOV, 99, 8000);
  const lastBookingDate = totalBookings > 0
    ? addDays(effectiveFirstBooking ?? DATE_START, randInt(0, Math.min(diffDays(effectiveFirstBooking ?? DATE_START, DATE_END), totalBookings * 30)))
    : null;

  customers.push({
    customer_id: customerId,
    signup_date: signupOffset,
    archetype: archetypeKey,
    age,
    age_group: ageGroup(age),
    gender,
    city: cityDef.city,
    state: cityDef.state,
    city_tier: cityDef.tier,
    hub_id: cityDef.hub_id,
    acquisition_channel: acqChannel,
    install_platform: platform,
    device_model_tier: weightedPick(["budget","mid_range","premium"], [0.38, 0.44, 0.18]),
    first_landing_test_category: weightedPick(["full_body","thyroid","diabetes","vitamins","hematology","fever","cardiac"], [0.35, 0.18, 0.12, 0.11, 0.10, 0.08, 0.06]),
    days_to_first_booking: daysToFirstBooking,
    referrer_customer_id: referrerId,
    coupon_used_at_signup: rand() < 0.42,
    health_goal: pick(HEALTH_GOALS),
    primary_health_concern: pick(HEALTH_CONCERNS),
    chronic_condition: chronic,
    family_history: weightedPick(["none","diabetes","hypertension","heart_disease","cancer","thyroid"], [0.38, 0.22, 0.18, 0.10, 0.07, 0.05]),
    smoking_status: weightedPick(["never","former","current"], [0.68, 0.18, 0.14]),
    alcohol_consumption: weightedPick(["never","occasional","regular"], [0.55, 0.32, 0.13]),
    exercise_frequency: weightedPick(["sedentary","1-2x_week","3-4x_week","daily"], [0.42, 0.28, 0.20, 0.10]),
    bmi_category: bmiCat,
    on_regular_medication: chronic !== "none" ? rand() < 0.72 : rand() < 0.12,
    last_doctor_visit_timeframe: weightedPick(["last_month","last_3_months","last_6_months","last_year","over_1_year"], [0.15, 0.22, 0.28, 0.20, 0.15]),
    insurance_provider: rand() < 0.38 ? pick(INSURANCE_PROVIDERS) : null,
    insurance_linked_to_healthians: rand() < 0.14,
    family_members_added: Math.round(Math.max(0, normalRand(0.62, 0.9))),
    books_primarily_for: weightedPick(["self","spouse","parent","child"], [0.58, 0.18, 0.16, 0.08]),
    total_bookings: totalBookings,
    total_spend_inr: totalSpend,
    avg_order_value_inr: totalBookings > 0 ? Math.round(totalSpend / totalBookings) : 0,
    first_booking_date: effectiveFirstBooking,
    last_booking_date: lastBookingDate,
    days_since_last_booking: lastBookingDate ? diffDays(lastBookingDate, DATE_END) : null,
    most_booked_category: pick(["full_body","thyroid","diabetes","vitamins","hematology","fever"]),
    preferred_slot_band: weightedPick(SLOT_BANDS, SLOT_BAND_WEIGHTS),
    preferred_payment_method: weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS),
    cancellation_rate_pct: roundTo(rand() * 15, 1),
    report_view_rate_pct: roundTo(clamp(normalRand(
      archetypeKey === "health_anxious" ? 92 : archetypeKey === "chronic_subscriber" ? 88 : 72, 15
    ), 0, 100), 1),
    counseling_uptake_pct: roundTo(ARCHETYPES[archetypeKey].counseling_uptake * 100 + normalRand(0, 5), 1),
    subscription_active: archetypeKey === "chronic_subscriber" ? rand() < 0.55 : rand() < 0.06,
    vitamin_d_status: weightedPick(["normal","deficient","severely_deficient"], [0.27, 0.45, 0.28]),
    vitamin_b12_status: weightedPick(["normal","low","deficient"], [0.48, 0.32, 0.20]),
    thyroid_status: chronic === "thyroid"
      ? weightedPick(["hypothyroid","hyperthyroid","subclinical_hypo"], [0.62, 0.18, 0.20])
      : weightedPick(["normal","subclinical_hypo","subclinical_hyper"], [0.82, 0.13, 0.05]),
    glucose_status: chronic === "diabetes"
      ? weightedPick(["diabetic","prediabetic","controlled_diabetic"], [0.45, 0.30, 0.25])
      : weightedPick(["normal","prediabetic","borderline"], [0.65, 0.24, 0.11]),
    cholesterol_status: weightedPick(["normal","borderline_high","high"], [0.56, 0.30, 0.14]),
    hemoglobin_status: weightedPick(["normal","mild_anemia","moderate_anemia"], [0.62, 0.29, 0.09]),
    lifetime_abnormal_flags_count: Math.max(0, Math.round(normalRand(2.4, 2.1))),
    customer_lifecycle_stage: lifecycleStage,
    ltv_bucket: totalSpend < 500 ? "low" : totalSpend < 2000 ? "medium" : totalSpend < 6000 ? "high" : "vip",
    nps_category: weightedPick(["promoter","passive","detractor"], [0.52, 0.31, 0.17]),
    push_opt_in: rand() < 0.78,
    whatsapp_opt_in: rand() < 0.82,
    is_active: lifecycleStage !== "churned" && rand() < 0.88,
  });
}

writeCsv("customers.csv", [
  "customer_id","signup_date","archetype","age","age_group","gender",
  "city","state","city_tier","hub_id","acquisition_channel","install_platform",
  "device_model_tier","first_landing_test_category","days_to_first_booking",
  "referrer_customer_id","coupon_used_at_signup","health_goal","primary_health_concern",
  "chronic_condition","family_history","smoking_status","alcohol_consumption",
  "exercise_frequency","bmi_category","on_regular_medication","last_doctor_visit_timeframe",
  "insurance_provider","insurance_linked_to_healthians","family_members_added",
  "books_primarily_for","total_bookings","total_spend_inr","avg_order_value_inr",
  "first_booking_date","last_booking_date","days_since_last_booking",
  "most_booked_category","preferred_slot_band","preferred_payment_method",
  "cancellation_rate_pct","report_view_rate_pct","counseling_uptake_pct",
  "subscription_active","vitamin_d_status","vitamin_b12_status","thyroid_status",
  "glucose_status","cholesterol_status","hemoglobin_status","lifetime_abnormal_flags_count",
  "customer_lifecycle_stage","ltv_bucket","nps_category","push_opt_in","whatsapp_opt_in","is_active"
], customers as unknown as Record<string, unknown>[]);

const customerById = new Map(customers.map(c => [c.customer_id, c]));
const cityDefByCity = new Map(CITIES.map(c => [c.city, c]));

// ════════════════════════════════════════════════════════════════
// STEP 2: CUSTOMER ADDRESSES (~1.4 per customer avg)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 2: Generating customer_addresses.csv...");

const customerAddresses: Record<string, unknown>[] = [];
let addrSeq = 1;
const customerAddressMap = new Map<string, string[]>(); // customer_id → address_ids

for (const cust of customers) {
  const cityDef = cityDefByCity.get(cust.city)!;
  // 1.4 avg: 60% have 1, 32% have 2, 8% have 3
  const numAddr = weightedPick([1, 2, 3], [0.60, 0.32, 0.08]);
  const addrIds: string[] = [];
  for (let a = 0; a < numAddr; a++) {
    const addrId = `ADDR_${String(addrSeq++).padStart(7, "0")}`;
    addrIds.push(addrId);
    customerAddresses.push({
      address_id: addrId,
      customer_id: cust.customer_id,
      locality_sublocality: pick(cityDef.localities),
      house_flat_no: `${randInt(1, 999)}${pick(["","A","B","C",""])}`,
      building_landmark: pick(["Near Metro Station","Behind Mall","Opp. Park","Near Hospital","Main Road"]),
      pincode: String(randInt(100000, 999999)),
      city: cust.city,
      state: cust.state,
      address_type: a === 0 ? "home" : weightedPick(["office","other"], [0.6, 0.4]),
      is_default: a === 0,
      times_used: a === 0 ? randInt(1, 8) : randInt(0, 3),
    });
  }
  customerAddressMap.set(cust.customer_id, addrIds);
}

writeCsv("customer_addresses.csv", [
  "address_id","customer_id","locality_sublocality","house_flat_no","building_landmark",
  "pincode","city","state","address_type","is_default","times_used"
], customerAddresses);

// ════════════════════════════════════════════════════════════════
// STEP 3: CUSTOMER FAMILY MEMBERS (~0.62 per customer)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 3: Generating customer_family_members.csv...");

const familyMembers: Record<string, unknown>[] = [];
let memberSeq = 1;

for (const cust of customers) {
  // 38% have no family members; rest have 1-3
  if (rand() < 0.38) continue;
  const numMembers = weightedPick([1, 2, 3], [0.62, 0.30, 0.08]);
  for (let m = 0; m < numMembers; m++) {
    const rel = weightedPick(["spouse","child","parent","sibling"], [0.40, 0.25, 0.28, 0.07]);
    const memberAge = rel === "child" ? randInt(3, 18)
      : rel === "parent" ? randInt(50, 78)
      : rel === "spouse" ? clamp(Math.round(normalRand(cust.age, 5)), 20, 72)
      : randInt(20, 55);
    const memberGender = rel === "spouse"
      ? (cust.gender === "male" ? "female" : "male")
      : weightedPick(["male","female"], [0.5, 0.5]);
    familyMembers.push({
      member_id: `MEM_${String(memberSeq++).padStart(7, "0")}`,
      customer_id: cust.customer_id,
      relationship: rel,
      member_age: memberAge,
      member_gender: memberGender,
      member_health_concerns: pick(HEALTH_CONCERNS),
    });
  }
}

writeCsv("customer_family_members.csv", [
  "member_id","customer_id","relationship","member_age","member_gender","member_health_concerns"
], familyMembers);

// ════════════════════════════════════════════════════════════════
// STEP 4: CUSTOMER LIFESTYLE PROFILES (1:1 with customers)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 4: Generating customer_lifestyle_profiles.csv...");

const lifestyleProfiles: Record<string, unknown>[] = [];

for (const cust of customers) {
  const heightCm = cust.gender === "male"
    ? clamp(Math.round(normalRand(170, 7)), 152, 192)
    : clamp(Math.round(normalRand(158, 6)), 142, 178);
  const bmiTarget = cust.bmi_category === "underweight" ? normalRand(17, 1)
    : cust.bmi_category === "normal" ? normalRand(22, 1.5)
    : cust.bmi_category === "overweight" ? normalRand(27, 1.5)
    : normalRand(33, 2.5);
  const weightKg = roundTo((bmiTarget * (heightCm / 100) ** 2), 1);
  const bmi = roundTo(weightKg / ((heightCm / 100) ** 2), 1);

  // Blood pressure correlated with chronic condition
  const bpBase = cust.chronic_condition === "hypertension" ? normalRand(148, 12) : normalRand(120, 12);
  const bpSys = Math.round(clamp(bpBase, 90, 200));
  const bpDia = Math.round(clamp(bpSys * 0.62 + normalRand(5, 5), 60, 120));

  // Fasting glucose
  const glucoseMu = cust.chronic_condition === "diabetes" ? 148 : 92;
  const fastingGlucose = Math.round(clamp(normalRand(glucoseMu, 22), 60, 350));
  const ppGlucose = Math.round(clamp(fastingGlucose + normalRand(40, 20), 80, 420));

  lifestyleProfiles.push({
    customer_id: cust.customer_id,
    height_cm: heightCm,
    weight_kg: weightKg,
    bmi: bmi,
    bmi_category: cust.bmi_category,
    physical_activity_freq: cust.exercise_frequency,
    smoking_status: cust.smoking_status,
    food_preference: weightedPick(["vegetarian","non_vegetarian","eggetarian","vegan"], [0.38, 0.48, 0.11, 0.03]),
    blood_pressure_systolic: bpSys,
    blood_pressure_diastolic: bpDia,
    current_medications: cust.on_regular_medication
      ? pick(["Metformin","Levothyroxine","Amlodipine","Atorvastatin","Metoprolol","Pantoprazole","Vitamin D3","Iron supplement","None","Aspirin"])
      : "None",
    alcohol_consumption: cust.alcohol_consumption,
    family_history: cust.family_history,
    fasting_blood_sugar: fastingGlucose,
    postprandial_blood_sugar: ppGlucose,
    questionnaire_date: randomDateBetween(DATE_START, DATE_END),
  });
}

writeCsv("customer_lifestyle_profiles.csv", [
  "customer_id","height_cm","weight_kg","bmi","bmi_category","physical_activity_freq",
  "smoking_status","food_preference","blood_pressure_systolic","blood_pressure_diastolic",
  "current_medications","alcohol_consumption","family_history","fasting_blood_sugar",
  "postprandial_blood_sugar","questionnaire_date"
], lifestyleProfiles);

// ════════════════════════════════════════════════════════════════
// STEP 5: PHLEBOTOMISTS (derived count)
// Derived: total_bookings / (8 × 250 × 1.15) ≈ 540
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 5: Generating phlebotomists.csv...");

// Estimate total bookings: N_CUSTOMERS × avg_bookings_per_year × (26/12 months)
// avg ≈ 2.5 bookings/yr across archetypes → ~35284 × 2.5 × 2.17 = ~191K bookings
// phlebs = 191000 / (8 × 250 × 1.15) ≈ 83 per city, ~540 total
const N_PHLEBS = 540;
const phlebotomists: Record<string, unknown>[] = [];

for (let p = 0; p < N_PHLEBS; p++) {
  const city = pick(CITIES);
  const expMonths = randInt(3, 96);
  const certLevel = expMonths < 12 ? "basic" : expMonths < 36 ? weightedPick(["basic","naco_certified"], [0.5, 0.5]) : weightedPick(["naco_certified","advanced"], [0.65, 0.35]);
  const baseRating = certLevel === "advanced" ? normalRand(4.5, 0.3) : certLevel === "naco_certified" ? normalRand(4.3, 0.4) : normalRand(4.0, 0.5);
  phlebotomists.push({
    phlebotomist_id: `PHLEB_${String(p + 1).padStart(4, "0")}`,
    city: city.city,
    city_tier: city.tier,
    hub_id: city.hub_id,
    experience_months: expMonths,
    certification_level: certLevel,
    avg_rating: roundTo(clamp(baseRating, 1.0, 5.0), 2),
    is_active: rand() < 0.88,
    joined_date: addDays(DATE_START, -randInt(0, 800)),
  });
}

writeCsv("phlebotomists.csv", [
  "phlebotomist_id","city","city_tier","hub_id","experience_months",
  "certification_level","avg_rating","is_active","joined_date"
], phlebotomists);

const phlebsByHub = new Map<string, string[]>();
for (const p of phlebotomists) {
  const hub = p.hub_id as string;
  if (!phlebsByHub.has(hub)) phlebsByHub.set(hub, []);
  phlebsByHub.get(hub)!.push(p.phlebotomist_id as string);
}

// ════════════════════════════════════════════════════════════════
// STEP 6: BOOKINGS (derived from archetype simulation)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 6: Generating bookings.csv...");

// On-time rates by tier
const ONTIME_RATE: Record<string, number> = { metro: 0.91, tier1: 0.84, tier2: 0.75 };
const NOSHOW_RATE: Record<string, number>  = { metro: 0.02, tier1: 0.05, tier2: 0.08 };
const REJECTION_RATE: Record<string, number> = { metro: 0.02, tier1: 0.035, tier2: 0.055 };
const TAT_PARAMS: Record<string, [number, number]> = {
  metro: [9.2, 3.1], tier1: [15.4, 5.2], tier2: [26.8, 8.4]
};

// Day-of-week on-time modifier
const DOW_ONTIME: Record<number, number> = { 0: 0.95, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 0.97, 6: 0.90 };

// Customer lifecycle state → booking probability multiplier
const LIFECYCLE_MULT: Record<string, number> = {
  new: 0.7, activated: 1.0, engaged: 1.2, loyal: 1.3,
  at_risk: 0.3, churned: 0.04, reactivated: 1.1,
};

// Test category selection by archetype+chronic
function pickTestSlug(archetype: ArchetypeKey, chronic: string, month: number): string {
  // Reactive booker in dengue season
  if (archetype === "reactive_booker" && [7, 8, 9].includes(month)) {
    return weightedPick(["fever","dengue","cbc","typhoid","full_body"], [0.40, 0.25, 0.15, 0.10, 0.10]);
  }
  if (archetype === "chronic_subscriber") {
    if (chronic === "diabetes")
      return weightedPick(["hba1c","kidney","full_body","thyroid","diabetes_checkup"], [0.35, 0.20, 0.15, 0.10, 0.20]);
    if (chronic === "thyroid")
      return weightedPick(["thyroid","full_body","vitamin_d","vitamin_b12","thyroid_tsh"], [0.50, 0.20, 0.15, 0.10, 0.05]);
    return weightedPick(["full_body","hba1c","thyroid","kidney","lipid"], [0.25, 0.25, 0.20, 0.15, 0.15]);
  }
  if (archetype === "annual_checker")
    return weightedPick(["full_body","cardiac","diabetes_checkup","full_body_basic","lipid"], [0.65, 0.10, 0.10, 0.08, 0.07]);
  if (archetype === "health_anxious")
    return weightedPick(["full_body","cardiac","thyroid","diabetes_checkup","hba1c"], [0.30, 0.20, 0.18, 0.18, 0.14]);
  if (archetype === "doctor_referred")
    return weightedPick(["hba1c","thyroid","lipid","kidney","liver","cbc"], [0.22, 0.18, 0.18, 0.16, 0.14, 0.12]);
  if (archetype === "one_and_done")
    return weightedPick(["full_body","thyroid","vitamin_d","full_body_basic","cbc"], [0.40, 0.20, 0.15, 0.15, 0.10]);
  if (archetype === "reactive_booker")
    return weightedPick(["cbc","vitamin_d","thyroid","full_body","liver"], [0.30, 0.20, 0.15, 0.10, 0.25]);
  return "full_body";
}

interface Booking {
  booking_id: string;
  customer_id: string;
  booking_date: string;
  booking_time: string;
  slot_date: string;
  slot_band: string;
  city: string;
  pincode: string;
  hub_id: string;
  address_id: string;
  primary_test_category: string;
  tests_count: number;
  advertised_price_inr: number;
  consumables_transport_fee_inr: number;
  hard_copy_fee_inr: number;
  diet_consultation_fee_inr: number;
  coupon_discount_inr: number;
  cashback_earned_inr: number;
  total_paid_inr: number;
  payment_method: string;
  booking_channel: string;
  patient_age: number;
  patient_gender: string;
  patient_relationship: string;
  patient_is_minor: boolean;
  persons_in_booking: number;
  is_family_bundle: boolean;
  is_first_booking: boolean;
  is_prescription_driven: boolean;
  is_subscription_run: boolean;
  subscription_id: string | null;
  on_time: boolean;
  delay_min: number;
  no_show: boolean;
  sample_rejected: boolean;
  rejection_reason: string | null;
  tat_hours: number;
  tat_breach: boolean;
  report_viewed: boolean;
  time_to_view_hours: number | null;
  counseling_taken: boolean;
  follow_up_booked: boolean;
  billing_dispute: boolean;
  cancellation_reason: string | null;
  booking_status: string;
  city_tier: string;
}

const bookings: Booking[] = [];
let bookingSeq = 1;
const customerBookingDates = new Map<string, string[]>(); // customer_id → sorted booking dates

for (const cust of customers) {
  const cityDef = cityDefByCity.get(cust.city)!;
  const tier = cityDef.tier;
  const lifecycle = cust.customer_lifecycle_stage;
  const archetype = ARCHETYPES[cust.archetype];
  const lifecycleMult = LIFECYCLE_MULT[lifecycle] ?? 1.0;
  const addrIds = customerAddressMap.get(cust.customer_id) ?? [];

  let pendingFollowUp = false;
  let firstBookingDone = false;
  let bookingCount = 0;

  for (const [y, m] of MONTHS) {
    // Monthly booking probability
    const baseMonthlyProb = (archetype.bookings_per_year_mu / 12);
    const seasonMult = bookingSeasonMultiplier(m);
    // Tax-season boost for annual_checker
    const taxBoost = cust.archetype === "annual_checker" && [1, 2, 3].includes(m)
      ? (ARCHETYPES.annual_checker as typeof ARCHETYPES.annual_checker).tax_season_mult ?? 1.0
      : 1.0;
    const followUpMult = pendingFollowUp ? 1.4 : 1.0;
    const monthlyProb = clamp(baseMonthlyProb * seasonMult * lifecycleMult * taxBoost * followUpMult, 0, 0.95);

    // Roll for this month
    if (rand() > monthlyProb) continue;

    // Occasional double-booking in same month for health_anxious
    const nBookingsThisMonth = (cust.archetype === "health_anxious" && rand() < 0.12) ? 2 : 1;

    for (let nb = 0; nb < nBookingsThisMonth; nb++) {
      const slotDate = randomDateInMonth(y, m);
      if (slotDate > DATE_END) continue;
      const bookingDate = addDays(slotDate, -randInt(1, 3));

      const testSlug = pickTestSlug(cust.archetype, cust.chronic_condition, m);
      const testDef = testBySlug.get(testSlug) ?? testBySlug.get("full_body")!;

      const slotBand = weightedPick(SLOT_BANDS, SLOT_BAND_WEIGHTS);
      const channel = weightedPick(BOOKING_CHANNELS, BOOKING_CHANNEL_WEIGHTS);
      const payMethod = weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS);
      const addrId = addrIds.length > 0 ? pick(addrIds) : "ADDR_DEFAULT";

      // Patient info
      const patientRel = weightedPick(["self","child","spouse","parent","sibling"], [0.65, 0.13, 0.12, 0.07, 0.03]);
      const patientAge = patientRel === "self" ? cust.age
        : patientRel === "child" ? randInt(3, 18)
        : patientRel === "parent" ? randInt(52, 78)
        : clamp(Math.round(normalRand(cust.age, 6)), 20, 72);
      const patientGender = patientRel === "spouse"
        ? (cust.gender === "male" ? "female" : "male")
        : cust.gender;

      // Pricing
      const advertised = testDef.list_price_inr;
      const consumFee = rand() < 0.87 ? 98 : 0; // The ₹98 hidden fee
      const hardCopyFee = rand() < 0.08 ? 199 : 0;
      const dietFee = rand() < 0.05 ? 199 : 0;
      const discount = rand() < 0.35 ? Math.round(advertised * (rand() * 0.20 + 0.05) / 10) * 10 : 0;
      const cashback = rand() < 0.12 ? Math.round(advertised * 0.03 / 5) * 5 : 0;
      const totalPaid = advertised + consumFee + hardCopyFee + dietFee - discount;

      // Causal outcomes
      const dow = dayOfWeek(slotDate);
      const ontimeMult = DOW_ONTIME[dow] ?? 1.0;
      const seasonMod = [7, 8].includes(m) ? 0.92 : 1.0;
      const onTime = rand() < (ONTIME_RATE[tier] ?? 0.85) * ontimeMult * seasonMod;
      const delayMin = onTime ? 0 : Math.round(clamp(Math.abs(normalRand(22, 15)), 5, 90));

      const noShowRateBase = (NOSHOW_RATE[tier] ?? 0.05) * ([7, 8].includes(m) ? 2.0 : 1.0);
      const noShow = rand() < noShowRateBase;

      const rejectionRateBase = (REJECTION_RATE[tier] ?? 0.03)
        * (patientAge > 70 ? 1.8 : 1.0)
        * ([5, 6].includes(m) && tier === "tier2" ? 2.2 : 1.0);
      const sampleRejected = !noShow && rand() < rejectionRateBase;
      const rejectionReason = sampleRejected
        ? weightedPick(["hemolysis","insufficient_volume","wrong_tube","temperature_breach","labelling_error"], [0.32, 0.24, 0.18, 0.15, 0.11])
        : null;

      const tatParams = TAT_PARAMS[tier] ?? [15, 5];
      const tatHours = roundTo(clamp(normalRand(tatParams[0], tatParams[1]), 4, 72), 1);
      const tatSla = tier === "metro" ? 12 : tier === "tier1" ? 24 : 36;
      const tatBreach = tatHours > tatSla;

      // Report viewed: causal on archetype
      const reportViewRate = cust.archetype === "health_anxious" ? 0.96
        : cust.archetype === "chronic_subscriber" ? 0.91
        : cust.archetype === "one_and_done" ? 0.61
        : 0.75;
      const reportViewed = !noShow && !sampleRejected && rand() < reportViewRate;
      const timeToViewHours = reportViewed ? roundTo(clamp(normalRand(4.5, 3.2), 0.25, 72), 1) : null;

      // Counseling: causal on report_viewed
      const counselingUptake = ARCHETYPES[cust.archetype].counseling_uptake;
      const counselingTaken = reportViewed && rand() < counselingUptake;
      pendingFollowUp = counselingTaken && rand() < 0.45;

      const followUpBooked = counselingTaken && rand() < 0.38;
      const billingDispute = advertised === 99 && rand() < 0.08; // ₹99 package hidden ₹98 fee

      const isCancelled = !firstBookingDone ? false : rand() < 0.042;
      const bookingStatus = isCancelled ? "cancelled" : noShow ? "completed" : "completed";
      const cancellationReason = isCancelled
        ? pick(["changed_mind","rescheduled","price_concern","not_feeling_well","phlebotomist_issue"])
        : null;

      const bId = `BKG_${String(bookingSeq++).padStart(7, "0")}`;

      bookings.push({
        booking_id: bId,
        customer_id: cust.customer_id,
        booking_date: bookingDate,
        booking_time: tsStr(bookingDate, randInt(7, 22), randInt(0, 59)),
        slot_date: slotDate,
        slot_band: slotBand,
        city: cust.city,
        pincode: String(randInt(100000, 999999)),
        hub_id: cust.hub_id,
        address_id: addrId,
        primary_test_category: testDef.category,
        tests_count: 1,
        advertised_price_inr: advertised,
        consumables_transport_fee_inr: consumFee,
        hard_copy_fee_inr: hardCopyFee,
        diet_consultation_fee_inr: dietFee,
        coupon_discount_inr: discount,
        cashback_earned_inr: cashback,
        total_paid_inr: totalPaid,
        payment_method: payMethod,
        booking_channel: channel,
        patient_age: patientAge,
        patient_gender: patientGender,
        patient_relationship: patientRel,
        patient_is_minor: patientAge < 18,
        persons_in_booking: weightedPick([1, 2, 3], [0.78, 0.17, 0.05]),
        is_family_bundle: rand() < 0.09,
        is_first_booking: !firstBookingDone,
        is_prescription_driven: cust.archetype === "doctor_referred" ? rand() < 0.78 : rand() < 0.12,
        is_subscription_run: cust.subscription_active && rand() < 0.35,
        subscription_id: null, // filled in step 14
        on_time: onTime,
        delay_min: delayMin,
        no_show: noShow,
        sample_rejected: sampleRejected,
        rejection_reason: rejectionReason,
        tat_hours: tatHours,
        tat_breach: tatBreach,
        report_viewed: reportViewed,
        time_to_view_hours: timeToViewHours,
        counseling_taken: counselingTaken,
        follow_up_booked: followUpBooked,
        billing_dispute: billingDispute,
        cancellation_reason: cancellationReason,
        booking_status: bookingStatus,
        city_tier: tier,
      });

      if (!firstBookingDone) firstBookingDone = true;
      bookingCount++;

      if (!customerBookingDates.has(cust.customer_id)) {
        customerBookingDates.set(cust.customer_id, []);
      }
      customerBookingDates.get(cust.customer_id)!.push(slotDate);
    }
  }
}

writeCsv("bookings.csv", [
  "booking_id","customer_id","booking_date","booking_time","slot_date","slot_band",
  "city","pincode","hub_id","address_id","primary_test_category","tests_count",
  "advertised_price_inr","consumables_transport_fee_inr","hard_copy_fee_inr",
  "diet_consultation_fee_inr","coupon_discount_inr","cashback_earned_inr","total_paid_inr",
  "payment_method","booking_channel","patient_age","patient_gender","patient_relationship",
  "patient_is_minor","persons_in_booking","is_family_bundle","is_first_booking",
  "is_prescription_driven","is_subscription_run","subscription_id","on_time","delay_min",
  "no_show","sample_rejected","rejection_reason","tat_hours","tat_breach",
  "report_viewed","time_to_view_hours","counseling_taken","follow_up_booked",
  "billing_dispute","cancellation_reason","booking_status","city_tier"
], bookings as unknown as Record<string, unknown>[]);

const bookingById = new Map(bookings.map(b => [b.booking_id, b]));
const bookingsByCustomer = new Map<string, Booking[]>();
for (const b of bookings) {
  if (!bookingsByCustomer.has(b.customer_id)) bookingsByCustomer.set(b.customer_id, []);
  bookingsByCustomer.get(b.customer_id)!.push(b);
}

console.log(`\n📊 Booking summary:`);
console.log(`  Total bookings:      ${bookings.length.toLocaleString()}`);
console.log(`  Completed:           ${bookings.filter(b => b.booking_status === "completed").toLocaleString !== undefined ? bookings.filter(b => b.booking_status === "completed").length.toLocaleString() : ""}`);
console.log(`  No-shows:            ${bookings.filter(b => b.no_show).length.toLocaleString()}`);
console.log(`  Sample rejected:     ${bookings.filter(b => b.sample_rejected).length.toLocaleString()}`);
console.log(`  Report viewed:       ${bookings.filter(b => b.report_viewed).length.toLocaleString()}`);
console.log(`  Counseling taken:    ${bookings.filter(b => b.counseling_taken).length.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════
// STEP 7: BOOKING ITEMS (~1.05 per booking)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 7: Generating booking_items.csv...");

const bookingItems: Record<string, unknown>[] = [];
let itemSeq = 1;
const bookingItemsByBooking = new Map<string, string[]>(); // booking_id → test_slugs

for (const booking of bookings) {
  const primaryTest = testBySlug.get(
    // pick a test that matches the booking's primary_test_category
    TEST_CATALOG.find(t => t.category === booking.primary_test_category)?.slug ?? "full_body"
  ) ?? testBySlug.get("full_body")!;

  const itemId = `ITEM_${String(itemSeq++).padStart(7, "0")}`;
  bookingItems.push({
    item_id: itemId,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    test_slug: primaryTest.slug,
    test_name: primaryTest.name,
    test_category: primaryTest.category,
    parameters_count: primaryTest.params_count,
    item_price_inr: booking.advertised_price_inr,
    item_type: "primary",
  });
  bookingItemsByBooking.set(booking.booking_id, [primaryTest.slug]);

  // 5% addon
  if (rand() < 0.05) {
    const addon = pick(TEST_CATALOG.filter(t => t.slug !== primaryTest.slug && t.list_price_inr < 600));
    const addonItemId = `ITEM_${String(itemSeq++).padStart(7, "0")}`;
    bookingItems.push({
      item_id: addonItemId,
      booking_id: booking.booking_id,
      customer_id: booking.customer_id,
      test_slug: addon.slug,
      test_name: addon.name,
      test_category: addon.category,
      parameters_count: addon.params_count,
      item_price_inr: addon.list_price_inr,
      item_type: "addon_pathology",
    });
    bookingItemsByBooking.get(booking.booking_id)!.push(addon.slug);
  }
}

writeCsv("booking_items.csv", [
  "item_id","booking_id","customer_id","test_slug","test_name","test_category",
  "parameters_count","item_price_inr","item_type"
], bookingItems);

// ════════════════════════════════════════════════════════════════
// STEP 8: PHLEBOTOMIST ASSIGNMENTS
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 8: Generating phlebotomist_assignments.csv...");

const assignableBookings = bookings.filter(b => b.booking_status !== "cancelled");
const assignments: Record<string, unknown>[] = [];
let assignSeq = 1;
const assignmentByBooking = new Map<string, string>(); // booking_id → phlebotomist_id
const lastPhlebByCustomer = new Map<string, string>(); // customer_id → last phleb

for (const booking of assignableBookings) {
  const hubId = booking.hub_id;
  const phlebPool = phlebsByHub.get(hubId) ?? phlebotomists.filter(p => p.is_active).map(p => p.phlebotomist_id as string);
  if (phlebPool.length === 0) continue;

  const lastPhleb = lastPhlebByCustomer.get(booking.customer_id);
  const customerRequestRepeated = lastPhleb && rand() < 0.18 ? true : false;
  const phlebId = customerRequestRepeated && lastPhleb && phlebPool.includes(lastPhleb)
    ? lastPhleb
    : pick(phlebPool);

  lastPhlebByCustomer.set(booking.customer_id, phlebId);

  const slotStartHour = parseInt(booking.slot_band.split("-")[0]) || 8;
  const assignedAt = addMinutes(tsStr(booking.booking_date, randInt(18, 23), randInt(0, 59)), 0);
  const arrivedAt = tsStr(
    booking.slot_date,
    slotStartHour,
    booking.on_time ? randInt(0, 10) : Math.min(59, randInt(15, booking.delay_min + 15))
  );
  const collectionDur = Math.round(clamp(normalRand(12, 4), 5, 30));

  const asgId = `ASG_${String(assignSeq++).padStart(7, "0")}`;
  assignments.push({
    assignment_id: asgId,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    phlebotomist_id: phlebId,
    assigned_at: assignedAt,
    arrived_at: arrivedAt,
    on_time: booking.on_time,
    delay_min: booking.delay_min,
    no_show: booking.no_show,
    collection_duration_min: booking.no_show ? null : collectionDur,
    tubes_collected: booking.no_show ? 0 : randInt(1, 5),
    communication_issue: rand() < 0.04,
    customer_request_repeated: customerRequestRepeated,
  });
  assignmentByBooking.set(booking.booking_id, phlebId);
}

writeCsv("phlebotomist_assignments.csv", [
  "assignment_id","booking_id","customer_id","phlebotomist_id",
  "assigned_at","arrived_at","on_time","delay_min","no_show",
  "collection_duration_min","tubes_collected","communication_issue","customer_request_repeated"
], assignments);

// ════════════════════════════════════════════════════════════════
// STEP 9: SAMPLE TRACKING
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 9: Generating sample_tracking.csv...");

const collectableBookings = assignableBookings.filter(b => !b.no_show);
const sampleTracking: Record<string, unknown>[] = [];
let sampleSeq = 1;
const sampleByBooking = new Map<string, string>(); // booking_id → sample_id

let labIdCounter = 1;
const LAB_BY_TIER: Record<string, string> = {};
for (const city of CITIES) {
  LAB_BY_TIER[city.city] = city.tier === "metro"
    ? `LAB_OWN_${city.hub_id}`
    : city.tier === "tier1"
      ? `LAB_PARTNER_${city.hub_id}`
      : `LAB_HUB_${city.hub_id}`;
}

for (const booking of collectableBookings) {
  const collectedAt = (() => {
    const slotHour = parseInt(booking.slot_band.split("-")[0]) || 8;
    return tsStr(booking.slot_date, slotHour, randInt(8, 18));
  })();

  const transitRoute = booking.city_tier === "metro" ? "direct"
    : booking.city_tier === "tier1" ? weightedPick(["direct","hub_batch"], [0.6, 0.4])
    : weightedPick(["hub_batch","overnight_courier"], [0.55, 0.45]);

  const transitHours = booking.city_tier === "metro" ? roundTo(normalRand(1.5, 0.5), 1)
    : booking.city_tier === "tier1" ? roundTo(normalRand(3.5, 1.2), 1)
    : roundTo(normalRand(8.5, 2.5), 1);

  const dispatchAt = addHours(collectedAt, roundTo(normalRand(0.5, 0.3), 1));
  const labReceivedAt = addHours(dispatchAt, transitHours);
  const processingStartAt = addHours(labReceivedAt, roundTo(normalRand(0.8, 0.4), 1));
  const reportGeneratedAt = addHours(processingStartAt, roundTo(normalRand(booking.tat_hours * 0.65, 1.5), 1));

  const qcStatus = booking.sample_rejected ? "rejected" : "accepted";
  const temperatureBreach = transitRoute === "overnight_courier" && rand() < 0.04;

  const sampleId = `SMP_${String(sampleSeq++).padStart(7, "0")}`;
  sampleTracking.push({
    sample_id: sampleId,
    booking_id: booking.booking_id,
    phlebotomist_id: assignmentByBooking.get(booking.booking_id) ?? "",
    lab_id: LAB_BY_TIER[booking.city] ?? `LAB_DEFAULT`,
    collection_timestamp: collectedAt,
    dispatch_timestamp: dispatchAt,
    transit_route: transitRoute,
    lab_received_timestamp: labReceivedAt,
    transit_hours: roundTo(transitHours, 2),
    qc_status: qcStatus,
    rejection_reason: booking.sample_rejected ? booking.rejection_reason : null,
    processing_started_at: qcStatus === "accepted" ? processingStartAt : null,
    report_generated_at: qcStatus === "accepted" ? reportGeneratedAt : null,
    tat_hours: booking.tat_hours,
    tat_sla_met: !booking.tat_breach,
    temperature_breach: temperatureBreach,
  });
  if (qcStatus === "accepted") sampleByBooking.set(booking.booking_id, sampleId);
}

writeCsv("sample_tracking.csv", [
  "sample_id","booking_id","phlebotomist_id","lab_id","collection_timestamp",
  "dispatch_timestamp","transit_route","lab_received_timestamp","transit_hours",
  "qc_status","rejection_reason","processing_started_at","report_generated_at",
  "tat_hours","tat_sla_met","temperature_breach"
], sampleTracking);

// ════════════════════════════════════════════════════════════════
// STEP 10: REPORTS (1:1 with accepted samples)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 10: Generating reports.csv...");

const acceptedBookingIds = new Set(sampleByBooking.keys());
const reportableBookings = bookings.filter(b => acceptedBookingIds.has(b.booking_id));
const reports: Record<string, unknown>[] = [];
let reportSeq = 1;
const reportByBooking = new Map<string, string>(); // booking_id → report_id

for (const booking of reportableBookings) {
  const sampleTrack = sampleTracking.find(s => s.booking_id === booking.booking_id);
  const reportGenAt = sampleTrack?.report_generated_at as string ?? tsStr(booking.slot_date, 18, 0);
  const reportReleasedAt = addMinutes(reportGenAt, randInt(10, 45));
  const notifSentAt = addMinutes(reportReleasedAt, randInt(1, 10));

  // Health score calculation
  const cust = customerById.get(booking.customer_id)!;
  const criticalParams = cust.chronic_condition !== "none" ? randInt(0, 2) : 0;
  const borderlineParams = Math.round(clamp(normalRand(2.8, 2.0), 0, 8));
  const abnormalParams = criticalParams + borderlineParams + Math.round(clamp(normalRand(1.2, 1.5), 0, 5));
  const healthScore = clamp(100 - criticalParams * 15 - borderlineParams * 8 - Math.max(0, abnormalParams - criticalParams - borderlineParams) * 4, 20, 98);
  const healthScoreCat = healthScore >= 85 ? "excellent" : healthScore >= 70 ? "good" : healthScore >= 50 ? "fair" : "poor";

  const notifChannels = [
    booking.report_viewed ? "push" : null,
    rand() < 0.82 ? "whatsapp" : null,
    rand() < 0.75 ? "sms" : null,
  ].filter(Boolean).join(",") || "sms";

  const reportId = `RPT_${String(reportSeq++).padStart(7, "0")}`;
  reportByBooking.set(booking.booking_id, reportId);

  reports.push({
    report_id: reportId,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    report_date: booking.slot_date,
    health_score: healthScore,
    health_score_category: healthScoreCat,
    critical_params_count: criticalParams,
    borderline_params_count: borderlineParams,
    abnormal_params_count: abnormalParams,
    keep_watching_params: abnormalParams > 0
      ? ["Haemoglobin","TSH Ultra-Sensitive","Vitamin D","Blood Glucose Fasting","Cholesterol Total"].slice(0, Math.min(abnormalParams, 3)).join(";")
      : "",
    report_released_at: reportReleasedAt,
    notification_sent_at: notifSentAt,
    notification_channels: notifChannels,
    report_viewed: booking.report_viewed,
    time_to_view_hours: booking.time_to_view_hours,
    report_view_platform: booking.report_viewed
      ? weightedPick(["app_android","app_ios","web"], [0.62, 0.18, 0.20])
      : null,
    health_karma_viewed: booking.report_viewed && rand() < 0.48,
  });
}

writeCsv("reports.csv", [
  "report_id","booking_id","customer_id","report_date","health_score","health_score_category",
  "critical_params_count","borderline_params_count","abnormal_params_count","keep_watching_params",
  "report_released_at","notification_sent_at","notification_channels",
  "report_viewed","time_to_view_hours","report_view_platform","health_karma_viewed"
], reports);

const reportById = new Map(reports.map(r => [r.report_id as string, r]));

// ════════════════════════════════════════════════════════════════
// STEP 11: REPORT RESULTS (streaming — big table)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 11: Generating report_results.csv (streaming)...");

const RR_HEADERS = [
  "result_id","booking_id","customer_id","report_id","test_slug",
  "parameter_name","parameter_value","unit","reference_low","reference_high",
  "status","is_critical","is_borderline","is_abnormal",
];

writeCsvHeader("report_results.csv", RR_HEADERS);

let rrSeq = 1;
let rrTotal = 0;
let rrBuffer: Record<string, unknown>[] = [];

function flushRrBuffer() {
  if (rrBuffer.length === 0) return;
  writeCsvChunk("report_results.csv", RR_HEADERS, rrBuffer);
  rrTotal += rrBuffer.length;
  rrBuffer = [];
}

interface ParamDef {
  unit: string;
  ref: [number, number];
  mu?: number;
  sigma?: number;
  logmu?: number;
  logsigma?: number;
  male?: { mu: number; sigma: number };
  female?: { mu: number; sigma: number };
}

const PARAM_DISTRIBUTIONS: Record<string, ParamDef> = {
  "Haemoglobin":           { unit: "g/dL",    ref: [13.0, 17.0], male: { mu: 14.5, sigma: 1.2 }, female: { mu: 12.1, sigma: 1.3 } },
  "TLC":                   { unit: "th/cumm", ref: [4.0, 10.0],  mu: 7.2, sigma: 2.1 },
  "Platelet Count":        { unit: "thou/μL", ref: [150, 450],   mu: 250, sigma: 55 },
  "RBC":                   { unit: "M/cmm",   ref: [4.5, 5.5],   mu: 4.9, sigma: 0.4 },
  "MCV":                   { unit: "fl",      ref: [76, 96],     mu: 87,  sigma: 5 },
  "MCH":                   { unit: "pg",      ref: [27, 33],     mu: 29.5, sigma: 2 },
  "MCHC":                  { unit: "g/dL",    ref: [30, 35],     mu: 33,  sigma: 1.2 },
  "HCT":                   { unit: "%",       ref: [36, 46],     mu: 42,  sigma: 3 },
  "TSH Ultra-Sensitive":   { unit: "uIU/mL",  ref: [0.35, 5.5],  logmu: 0.69, logsigma: 0.55 },
  "T3 Total":              { unit: "ng/dL",   ref: [60, 200],    mu: 130, sigma: 25 },
  "T4 Total":              { unit: "μg/dL",   ref: [5.1, 14.1],  mu: 9.5, sigma: 2.1 },
  "FT3":                   { unit: "pg/mL",   ref: [2.3, 4.2],   mu: 3.1, sigma: 0.45 },
  "FT4":                   { unit: "ng/dL",   ref: [0.8, 1.8],   mu: 1.2, sigma: 0.25 },
  "HbA1c":                 { unit: "%",       ref: [4.0, 5.6],   mu: 5.8, sigma: 0.8 },
  "Blood Glucose Fasting": { unit: "mg/dL",   ref: [70, 100],    mu: 95,  sigma: 18 },
  "Random Blood Sugar":    { unit: "mg/dL",   ref: [70, 140],    mu: 115, sigma: 22 },
  "Cholesterol Total":     { unit: "mg/dL",   ref: [0, 200],     mu: 187, sigma: 38 },
  "HDL Cholesterol":       { unit: "mg/dL",   ref: [40, 60],     mu: 48,  sigma: 10 },
  "LDL Cholesterol":       { unit: "mg/dL",   ref: [0, 130],     mu: 118, sigma: 32 },
  "Triglycerides":         { unit: "mg/dL",   ref: [0, 150],     mu: 142, sigma: 45 },
  "SGPT/ALT":              { unit: "IU/L",    ref: [7, 40],      mu: 32,  sigma: 18 },
  "SGOT/AST":              { unit: "IU/L",    ref: [10, 40],     mu: 29,  sigma: 14 },
  "GGTP":                  { unit: "IU/L",    ref: [5, 40],      mu: 28,  sigma: 16 },
  "Alkaline Phosphatase":  { unit: "IU/L",    ref: [44, 147],    mu: 85,  sigma: 28 },
  "Albumin":               { unit: "g/dL",    ref: [3.5, 5.0],   mu: 4.3, sigma: 0.4 },
  "Bilirubin Total":       { unit: "mg/dL",   ref: [0.3, 1.2],   mu: 0.7, sigma: 0.3 },
  "Total Protein":         { unit: "g/dL",    ref: [6.0, 8.3],   mu: 7.2, sigma: 0.6 },
  "Creatinine":            { unit: "mg/dL",   ref: [0.6, 1.2],   male: { mu: 0.95, sigma: 0.2 }, female: { mu: 0.75, sigma: 0.15 } },
  "BUN":                   { unit: "mg/dL",   ref: [7, 25],      mu: 14,  sigma: 4 },
  "Urea":                  { unit: "mg/dL",   ref: [12.8, 42.8], mu: 27,  sigma: 8 },
  "Uric Acid":             { unit: "mg/dL",   ref: [3.5, 7.2],   mu: 5.5, sigma: 1.4 },
  "Sodium":                { unit: "mEq/L",   ref: [136, 145],   mu: 140, sigma: 3 },
  "Potassium":             { unit: "mEq/L",   ref: [3.5, 5.1],   mu: 4.2, sigma: 0.5 },
  "Vitamin D":             { unit: "ng/mL",   ref: [30, 100],    mu: 22,  sigma: 12 },
  "Vitamin B12":           { unit: "pg/mL",   ref: [187, 883],   mu: 310, sigma: 130 },
  "Iron":                  { unit: "μg/dL",   ref: [60, 170],    mu: 95,  sigma: 30 },
  "Ferritin":              { unit: "ng/mL",   ref: [12, 300],    mu: 65,  sigma: 45 },
  "hsCRP":                 { unit: "mg/L",    ref: [0, 3.0],     mu: 2.8, sigma: 2.1 },
  "Calcium Total":         { unit: "mg/dL",   ref: [8.5, 10.5],  mu: 9.3, sigma: 0.7 },
};

function generateParamValue(paramName: string, gender: string, chronic: string): number {
  const def = PARAM_DISTRIBUTIONS[paramName];
  if (!def) return roundTo(normalRand(50, 10), 2);

  let mu: number, sigma: number;

  if (def.logmu !== undefined && def.logsigma !== undefined) {
    let val = logNormalRand(def.logmu, def.logsigma);
    // Thyroid chronic condition shift
    if (paramName === "TSH Ultra-Sensitive" && chronic === "thyroid") {
      val = rand() < 0.62 ? logNormalRand(2.14, 0.4) : logNormalRand(-1.9, 0.6);
    }
    return roundTo(clamp(val, 0.001, 150), 3);
  }

  if (def.male && def.female) {
    const gDef = gender === "female" ? def.female : def.male;
    mu = gDef.mu; sigma = gDef.sigma;
  } else {
    mu = def.mu ?? 50;
    sigma = def.sigma ?? 10;
  }

  // Chronic condition adjustments
  if (paramName === "HbA1c" && chronic === "diabetes") mu += 1.2;
  if (paramName === "Blood Glucose Fasting" && chronic === "diabetes") mu += 35;
  if ((paramName === "Haemoglobin") && chronic === "multiple") mu -= 1.5;
  if (paramName === "Vitamin D") mu = 22; // India 73% deficient

  const val = normalRand(mu, sigma);
  return roundTo(Math.max(0, val), 2);
}

function paramStatus(value: number, ref: [number, number]): string {
  const [lo, hi] = ref;
  const range = hi - lo;
  if (value < lo - range * 0.30 || value > hi + range * 0.30) return "critical";
  if (value < lo - range * 0.05 || value > hi + range * 0.05) return "borderline";
  if (value < lo || value > hi) return "low";
  return "normal";
}

for (const booking of reportableBookings) {
  const cust = customerById.get(booking.customer_id)!;
  const reportId = reportByBooking.get(booking.booking_id);
  if (!reportId) continue;

  const testSlugs = bookingItemsByBooking.get(booking.booking_id) ?? ["full_body"];
  for (const slug of testSlugs) {
    const testDef = testBySlug.get(slug);
    if (!testDef) continue;

    for (const paramName of testDef.parameters) {
      const paramDef = PARAM_DISTRIBUTIONS[paramName];
      if (!paramDef) continue;

      const value = generateParamValue(paramName, booking.patient_gender, cust.chronic_condition);
      const status = paramStatus(value, paramDef.ref);
      const isCritical = status === "critical";
      const isBorderline = status === "borderline";
      const isAbnormal = status !== "normal";

      rrBuffer.push({
        result_id: `RES_${String(rrSeq++).padStart(8, "0")}`,
        booking_id: booking.booking_id,
        customer_id: booking.customer_id,
        report_id: reportId,
        test_slug: slug,
        parameter_name: paramName,
        parameter_value: value,
        unit: paramDef.unit,
        reference_low: paramDef.ref[0],
        reference_high: paramDef.ref[1],
        status,
        is_critical: isCritical,
        is_borderline: isBorderline,
        is_abnormal: isAbnormal,
      });

      if (rrBuffer.length >= 5000) flushRrBuffer();
    }
  }
}

flushRrBuffer();
console.log(`  ✓ report_results.csv: ${rrTotal.toLocaleString()} rows`);

// ════════════════════════════════════════════════════════════════
// STEP 12: COUNSELING SESSIONS (~18% of bookings)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 12: Generating counseling_sessions.csv...");

const counselingBookings = bookings.filter(b => b.counseling_taken);
const counselingSessions: Record<string, unknown>[] = [];
let counselSeq = 1;

for (const booking of counselingBookings) {
  const reportId = reportByBooking.get(booking.booking_id);
  const daysAfterReport = randInt(0, 5);
  const sessionDate = addDays(booking.slot_date, daysAfterReport);
  const cust = customerById.get(booking.customer_id)!;

  counselingSessions.push({
    session_id: `CSEL_${String(counselSeq++).padStart(6, "0")}`,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    report_id: reportId ?? null,
    counselor_type: weightedPick(["ai","human_advisor"], [0.62, 0.38]),
    session_date: sessionDate,
    days_after_report: daysAfterReport,
    duration_min: Math.round(clamp(normalRand(18, 8), 5, 60)),
    satisfaction_score: Math.round(clamp(normalRand(4.1, 0.8), 1, 5)),
    tests_discussed: pick(TEST_CATALOG).slug,
    follow_up_recommended: booking.follow_up_booked,
    follow_up_test_id: booking.follow_up_booked ? pick(TEST_CATALOG).slug : null,
    outcome: weightedPick(
      ["lifestyle_advice","follow_up_tests","normal_dismissed","prescription_given"],
      [0.40, 0.32, 0.18, 0.10]
    ),
  });
}

writeCsv("counseling_sessions.csv", [
  "session_id","booking_id","customer_id","report_id","counselor_type",
  "session_date","days_after_report","duration_min","satisfaction_score",
  "tests_discussed","follow_up_recommended","follow_up_test_id","outcome"
], counselingSessions);

// ════════════════════════════════════════════════════════════════
// STEP 13: REPORT FUTURE TESTS (driven by abnormal results)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 13: Generating report_future_tests.csv...");

const futureTests: Record<string, unknown>[] = [];
let futureTestSeq = 1;

// Rules: abnormal results → recommended tests
const FUTURE_TEST_RULES: Array<{
  slug: string;
  triggerParam: string;
  frequency: string;
  test_name: string;
}> = [
  { slug: "hba1c",      triggerParam: "HbA1c",                frequency: "every_3_months",  test_name: "HbA1c" },
  { slug: "thyroid_tsh",triggerParam: "TSH Ultra-Sensitive",   frequency: "every_6_months",  test_name: "TSH Ultra Sensitive" },
  { slug: "vitamin_d",  triggerParam: "Vitamin D",             frequency: "every_3_months",  test_name: "Vitamin D Total-25 Hydroxy" },
  { slug: "cbc",        triggerParam: "Haemoglobin",           frequency: "every_1_month",   test_name: "Complete Hemogram" },
  { slug: "lipid",      triggerParam: "Cholesterol Total",     frequency: "every_6_months",  test_name: "Lipid Profile Advance" },
  { slug: "kidney",     triggerParam: "Creatinine",            frequency: "every_3_months",  test_name: "Kidney Function Test Advance" },
];

for (const report of reports) {
  const booking = bookingById.get(report.booking_id as string);
  if (!booking) continue;

  // Find abnormal params for this report
  const abnormalCount = (report.abnormal_params_count as number) ?? 0;
  if (abnormalCount === 0) continue;

  for (const rule of FUTURE_TEST_RULES) {
    if (rand() < 0.25) { // 25% chance each rule fires for each report
      const bookedWithin = rand() < 0.42;
      const followupBookingId = bookedWithin
        ? bookings.find(b => b.customer_id === report.customer_id && b.slot_date > (report.report_date as string))?.booking_id ?? null
        : null;

      futureTests.push({
        recommendation_id: `FREC_${String(futureTestSeq++).padStart(6, "0")}`,
        booking_id: report.booking_id,
        customer_id: report.customer_id,
        report_id: report.report_id,
        test_name: rule.test_name,
        test_slug: rule.slug,
        recommended_frequency: rule.frequency,
        recommended_by: weightedPick(["report_advisory","counselor"], [0.65, 0.35]),
        created_at: addDays(report.report_date as string, randInt(0, 2)),
        booked_within_window: bookedWithin,
        followup_booking_id: followupBookingId,
      });
    }
  }
}

writeCsv("report_future_tests.csv", [
  "recommendation_id","booking_id","customer_id","report_id","test_name","test_slug",
  "recommended_frequency","recommended_by","created_at","booked_within_window","followup_booking_id"
], futureTests);

// ════════════════════════════════════════════════════════════════
// STEP 14: SUBSCRIPTIONS (~11% of customers)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 14: Generating subscriptions.csv...");

const subscribingCustomers = customers.filter(c =>
  c.subscription_active || (c.archetype === "chronic_subscriber" && rand() < 0.55)
);
const subscriptions: Record<string, unknown>[] = [];
let subSeq = 1;
const subscriptionByCustomer = new Map<string, string>();

const SUB_TEST_SLUGS: Record<string, string> = {
  diabetes: "hba1c",
  thyroid: "thyroid_tsh",
  hypertension: "lipid",
  pcos: "pcos",
  multiple: "full_body",
  none: "full_body",
};

for (const cust of subscribingCustomers.slice(0, Math.round(N_CUSTOMERS * 0.11))) {
  const testSlug = SUB_TEST_SLUGS[cust.chronic_condition] ?? "full_body";
  const testDef = testBySlug.get(testSlug) ?? testBySlug.get("full_body")!;
  const freqDays = cust.chronic_condition === "none" ? 365
    : cust.chronic_condition === "diabetes" ? 90
    : 180;

  const startDate = cust.first_booking_date ?? randomDateBetween(DATE_START, addDays(DATE_END, -90));
  const status = cust.subscription_active ? "active"
    : weightedPick(["paused","cancelled"], [0.3, 0.7]);

  const totalRuns = Math.floor(diffDays(startDate, DATE_END) / freqDays);
  const adherenceRate = roundTo(clamp(normalRand(78, 18), 0, 100), 1);

  const subId = `SUB_${String(subSeq++).padStart(5, "0")}`;
  subscriptionByCustomer.set(cust.customer_id, subId);
  subscriptions.push({
    subscription_id: subId,
    customer_id: cust.customer_id,
    test_slug: testSlug,
    test_name: testDef.name,
    frequency_days: freqDays,
    start_date: startDate,
    status,
    total_runs_completed: Math.max(0, totalRuns - randInt(0, 2)),
    next_due_date: status === "active" ? addDays(DATE_END, freqDays - (diffDays(startDate, DATE_END) % freqDays)) : null,
    adherence_rate_pct: adherenceRate,
  });
}

writeCsv("subscriptions.csv", [
  "subscription_id","customer_id","test_slug","test_name","frequency_days",
  "start_date","status","total_runs_completed","next_due_date","adherence_rate_pct"
], subscriptions);

// ════════════════════════════════════════════════════════════════
// STEP 15: SUBSCRIPTION RUNS
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 15: Generating subscription_runs.csv...");

const subscriptionRuns: Record<string, unknown>[] = [];
let runSeq = 1;

for (const sub of subscriptions) {
  const freqDays = sub.frequency_days as number;
  const startDate = sub.start_date as string;
  let scheduled = startDate;
  let runNum = 0;

  while (scheduled <= DATE_END) {
    runNum++;
    const adheres = rand() < (sub.adherence_rate_pct as number) / 100;
    const daysLate = adheres ? 0 : randInt(1, 14);
    const actualDate = adheres ? scheduled : addDays(scheduled, daysLate);
    const status = actualDate > DATE_END ? "skipped"
      : adheres ? "completed"
      : daysLate > 7 ? "late"
      : "completed";

    // Find matching booking if completed
    const matchedBooking = bookings.find(b =>
      b.customer_id === sub.customer_id && Math.abs(diffDays(b.slot_date, actualDate)) <= 7
    );

    subscriptionRuns.push({
      run_id: `SRUN_${String(runSeq++).padStart(6, "0")}`,
      subscription_id: sub.subscription_id,
      customer_id: sub.customer_id,
      booking_id: matchedBooking?.booking_id ?? null,
      run_number: runNum,
      scheduled_date: scheduled,
      actual_date: actualDate <= DATE_END ? actualDate : null,
      status,
      days_late: daysLate,
    });

    scheduled = addDays(scheduled, freqDays);
    if (runNum > 30) break; // Safety cap
  }
}

writeCsv("subscription_runs.csv", [
  "run_id","subscription_id","customer_id","booking_id","run_number",
  "scheduled_date","actual_date","status","days_late"
], subscriptionRuns);

// ════════════════════════════════════════════════════════════════
// STEP 16: COMMS LOG (CRM messages)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 16: Generating comms_log.csv...");

const commsLog: Record<string, unknown>[] = [];
let commsSeq = 1;

// Channel delivery/open/click rates
const CHANNEL_RATES: Record<string, { delivered: number; opened: number; clicked: number; cost: number }> = {
  whatsapp: { delivered: 0.97, opened: 0.94, clicked: 0.32, cost: 0.12 },
  push:     { delivered: 0.85, opened: 0.71, clicked: 0.18, cost: 0.01 },
  sms:      { delivered: 0.96, opened: 0.82, clicked: 0.08, cost: 0.08 },
  email:    { delivered: 0.88, opened: 0.24, clicked: 0.06, cost: 0.02 },
  in_app:   { delivered: 1.0,  opened: 0.91, clicked: 0.44, cost: 0.0  },
};

function addComm(custId: string, channel: string, campaignType: string, sentAt: string, bookingId: string | null, lifecycleStage: string, daysSinceLast: number | null) {
  const rates = CHANNEL_RATES[channel] ?? CHANNEL_RATES.sms;
  const delivered = rand() < rates.delivered;
  const opened = delivered && rand() < rates.opened;
  const clicked = opened && rand() < rates.clicked;
  const converted = clicked && rand() < 0.14;

  commsLog.push({
    send_id: `COMM_${String(commsSeq++).padStart(7, "0")}`,
    customer_id: custId,
    booking_id: bookingId,
    channel,
    campaign_type: campaignType,
    sent_at: sentAt,
    delivered,
    opened,
    clicked,
    converted,
    conversion_booking_id: null,
    send_cost_inr: roundTo(rates.cost, 2),
    user_segment_at_send: lifecycleStage,
    days_since_last_booking: daysSinceLast,
  });
}

for (const cust of customers) {
  const lifecycle = cust.customer_lifecycle_stage;
  const custBookings = bookingsByCustomer.get(cust.customer_id) ?? [];

  // Welcome series (new signups)
  if (cust.signup_date >= DATE_START) {
    for (const d of [0, 3, 7]) {
      const sentDate = addDays(cust.signup_date, d);
      if (sentDate > DATE_END) continue;
      const channel = weightedPick(["push","whatsapp","sms"], [0.5, 0.35, 0.15]);
      addComm(cust.customer_id, channel, "welcome_series", tsStr(sentDate, randInt(9, 18), randInt(0, 59)), null, lifecycle, null);
    }
  }

  // Seasonal alerts
  for (const [y, m] of MONTHS) {
    // Dengue season alert (Jul in high-dengue cities)
    if (m === 7 && ["metro","tier1"].includes(cust.city_tier)) {
      const sentDate = dateStr(y, 7, randInt(1, 10));
      if (sentDate <= DATE_END) {
        addComm(cust.customer_id, "whatsapp", "dengue_season_alert", tsStr(sentDate, 10, 0), null, lifecycle, null);
      }
    }
    // Tax deduction nudge (Feb-Mar)
    if (m === 2 || m === 3) {
      const sentDate = m === 2 ? dateStr(y, 2, 15) : dateStr(y, 3, pick([1, 15]));
      if (sentDate <= DATE_END) {
        const ch = weightedPick(["push","whatsapp","email"], [0.4, 0.4, 0.2]);
        addComm(cust.customer_id, ch, "tax_deduction_nudge", tsStr(sentDate, randInt(9, 18), 0), null, lifecycle, null);
      }
    }
    // Post-Diwali sugar check (Nov 1-10)
    if (m === 11) {
      const sentDate = dateStr(y, 11, randInt(1, 10));
      if (sentDate <= DATE_END) {
        addComm(cust.customer_id, "push", "post_diwali_sugar_check", tsStr(sentDate, randInt(9, 18), 0), null, lifecycle, null);
      }
    }
  }

  // Annual checkup reminder (365 days after last full_body)
  const fullBodyBookings = custBookings.filter(b => b.primary_test_category === "full_body");
  for (const fb of fullBodyBookings) {
    const reminderDate = addDays(fb.slot_date, 365);
    if (reminderDate <= DATE_END) {
      addComm(cust.customer_id, "whatsapp", "annual_checkup_reminder", tsStr(reminderDate, 9, 0), null, lifecycle, 365);
    }
  }

  // Report delivery notifications
  for (const b of custBookings) {
    const reportId = reportByBooking.get(b.booking_id);
    if (!reportId) continue;
    const rpt = reports.find(r => r.report_id === reportId);
    if (!rpt) continue;
    const notifAt = (rpt.notification_sent_at as string) ?? tsStr(b.slot_date, 18, 0);
    for (const ch of ["push","whatsapp","sms"]) {
      if (rand() < 0.7) {
        addComm(cust.customer_id, ch, "report_delivery", notifAt, b.booking_id, lifecycle, diffDays(DATE_START, b.slot_date));
      }
    }
  }

  // Reactivation (60+ days of inactivity)
  if (lifecycle === "at_risk" || lifecycle === "churned") {
    const reactivDate = addDays(DATE_START, randInt(30, 500));
    if (reactivDate <= DATE_END) {
      addComm(cust.customer_id, weightedPick(["push","whatsapp"], [0.5, 0.5]), "reactivation",
        tsStr(reactivDate, randInt(9, 18), 0), null, lifecycle, randInt(60, 365));
    }
  }
}

writeCsv("comms_log.csv", [
  "send_id","customer_id","booking_id","channel","campaign_type","sent_at",
  "delivered","opened","clicked","converted","conversion_booking_id",
  "send_cost_inr","user_segment_at_send","days_since_last_booking"
], commsLog);

// ════════════════════════════════════════════════════════════════
// STEP 17: NPS RESPONSES (~30% of bookings)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 17: Generating nps_responses.csv...");

const npsResponses: Record<string, unknown>[] = [];
let npsSeq = 1;
const NPS_FEEDBACK_POSITIVE = ["Great experience! Phlebotomist was punctual and professional.", "Very convenient service, reports were clear.", "Easy to book, quick report delivery.", "The health score feature is very helpful.", "Will recommend to family and friends."];
const NPS_FEEDBACK_NEUTRAL  = ["Service was okay, took a bit longer than expected.", "Reports were fine but the app could be better.", "Decent experience overall.", "Report delivery was slightly delayed."];
const NPS_FEEDBACK_NEGATIVE = ["Phlebotomist was very late.", "Report took longer than promised.", "Had trouble with billing, hidden charges.", "Sample got rejected, had to reschedule.", "App kept crashing during booking."];

for (const booking of bookings) {
  if (rand() > 0.30) continue;
  const cust = customerById.get(booking.customer_id)!;

  // NPS score by archetype + experience
  let npsMu = 7.4, npsSigma = 1.4;
  if (cust.archetype === "chronic_subscriber") { npsMu = 8.2; npsSigma = 1.1; }
  if (cust.archetype === "one_and_done") { npsMu = 6.2; npsSigma = 2.1; }
  if (booking.billing_dispute) { npsMu = 3.8; npsSigma = 2.0; }
  if (booking.no_show) { npsMu = 2.9; npsSigma = 1.8; }
  if (booking.tat_breach) { npsMu = 4.1; npsSigma = 1.9; }

  const score = clamp(Math.round(normalRand(npsMu, npsSigma)), 0, 10);
  const npsCategory = score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
  const sentiment = score >= 8 ? "positive" : score >= 6 ? "neutral" : "negative";
  const feedbackText = sentiment === "positive" ? pick(NPS_FEEDBACK_POSITIVE)
    : sentiment === "neutral" ? pick(NPS_FEEDBACK_NEUTRAL)
    : pick(NPS_FEEDBACK_NEGATIVE);

  npsResponses.push({
    response_id: `NPS_${String(npsSeq++).padStart(7, "0")}`,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    score,
    nps_category: npsCategory,
    feedback_text: feedbackText,
    submitted_at: addDays(booking.slot_date, randInt(1, 5)),
    days_after_booking: randInt(1, 5),
  });
}

writeCsv("nps_responses.csv", [
  "response_id","booking_id","customer_id","score","nps_category",
  "feedback_text","submitted_at","days_after_booking"
], npsResponses);

// ════════════════════════════════════════════════════════════════
// STEP 18: PHLEBOTOMIST RATINGS (~60% of bookings)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 18: Generating phlebotomist_ratings.csv...");

const phlebRatings: Record<string, unknown>[] = [];
let ratingSeq = 1;

for (const booking of assignableBookings) {
  if (rand() > 0.60) continue;
  const phlebId = assignmentByBooking.get(booking.booking_id);
  if (!phlebId) continue;

  // Rating: normally distributed around 4.3, lower for bad experiences
  let ratingMu = 4.3;
  if (booking.no_show) ratingMu = 1.8;
  else if (!booking.on_time) ratingMu = 3.4;

  const rating = Math.round(clamp(normalRand(ratingMu, 0.6), 1, 5));
  const sentiment = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";

  phlebRatings.push({
    rating_id: `PRAT_${String(ratingSeq++).padStart(7, "0")}`,
    booking_id: booking.booking_id,
    customer_id: booking.customer_id,
    phlebotomist_id: phlebId,
    rating,
    review_text_sentiment: sentiment,
    submitted_at: addDays(booking.slot_date, randInt(0, 3)),
  });
}

writeCsv("phlebotomist_ratings.csv", [
  "rating_id","booking_id","customer_id","phlebotomist_id",
  "rating","review_text_sentiment","submitted_at"
], phlebRatings);

// ════════════════════════════════════════════════════════════════
// STEP 19: SUPPORT TICKETS (~4% of bookings)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 19: Generating support_tickets.csv...");

const supportTickets: Record<string, unknown>[] = [];
let ticketSeq = 1;

const TICKET_CATEGORIES = ["delayed_report","wrong_result","incomplete_report","phlebotomist_no_show","phlebotomist_late","sample_rejected","billing_dispute","location_not_serviceable","refund_pending"];
const ROOT_CAUSES = ["phlebotomist","lab_processing","transit","billing_system","capacity"];

for (const booking of bookings) {
  // Higher probability for bad bookings
  const baseProb = 0.04;
  const ticketProb = booking.no_show ? 0.55
    : booking.sample_rejected ? 0.35
    : booking.tat_breach ? 0.12
    : booking.billing_dispute ? 0.22
    : baseProb;

  if (rand() > ticketProb) continue;

  const cust = customerById.get(booking.customer_id)!;
  const openedAt = addDays(booking.slot_date, randInt(0, 3));
  const resolutionDays = Math.round(clamp(normalRand(2.8, 1.8), 0.5, 14));
  const resolvedAt = addDays(openedAt, resolutionDays);
  const escalated = rand() < 0.12;

  const category = booking.no_show ? "phlebotomist_no_show"
    : booking.sample_rejected ? "sample_rejected"
    : booking.tat_breach ? "delayed_report"
    : booking.billing_dispute ? "billing_dispute"
    : pick(TICKET_CATEGORIES);

  supportTickets.push({
    ticket_id: `TKT_${String(ticketSeq++).padStart(6, "0")}`,
    customer_id: booking.customer_id,
    booking_id: booking.booking_id,
    opened_at: tsStr(openedAt, randInt(9, 20), randInt(0, 59)),
    resolved_at: tsStr(resolvedAt, randInt(9, 20), randInt(0, 59)),
    resolution_days: roundTo(resolutionDays, 1),
    channel: weightedPick(["app_chat","phone","email","whatsapp"], [0.38, 0.28, 0.18, 0.16]),
    category,
    city: cust.city,
    city_tier: cust.city_tier,
    root_cause: pick(ROOT_CAUSES),
    escalated,
    resolution: weightedPick(["resolved","refund_given","rebooked","no_resolution"], [0.58, 0.18, 0.16, 0.08]),
    nps_after_resolution: Math.round(clamp(normalRand(6.8, 1.8), 0, 10)),
  });
}

writeCsv("support_tickets.csv", [
  "ticket_id","customer_id","booking_id","opened_at","resolved_at","resolution_days",
  "channel","category","city","city_tier","root_cause","escalated","resolution","nps_after_resolution"
], supportTickets);

// ════════════════════════════════════════════════════════════════
// STEP 20: LEADS (12% of web bookings)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 20: Generating leads.csv...");

const webBookings = bookings.filter(b => ["web_self_serve","web_callback"].includes(b.booking_channel));
const leads: Record<string, unknown>[] = [];
let leadSeq = 1;

for (const booking of webBookings) {
  if (rand() > 0.12) continue;
  const cust = customerById.get(booking.customer_id)!;
  leads.push({
    lead_id: `LEAD_${String(leadSeq++).padStart(6, "0")}`,
    customer_id: rand() < 0.72 ? cust.customer_id : null,
    lead_type: weightedPick(["new_booking","customer_support_query"], [0.78, 0.22]),
    mobile_hash: `hash_${randInt(1000000, 9999999)}`,
    name: fullName(cust.gender),
    city: cust.city,
    test_context_slug: testBySlug.get(bookingItemsByBooking.get(booking.booking_id)?.[0] ?? "full_body")?.slug ?? "full_body",
    source_type: weightedPick(["package_page","nav_bar","home_banner"], [0.62, 0.24, 0.14]),
    submitted_at: booking.booking_time,
    consent_given: rand() < 0.94,
    outcome: weightedPick(["booked","no_answer","not_interested","rescheduled"], [0.55, 0.22, 0.14, 0.09]),
  });
}

writeCsv("leads.csv", [
  "lead_id","customer_id","lead_type","mobile_hash","name","city",
  "test_context_slug","source_type","submitted_at","consent_given","outcome"
], leads);

// ════════════════════════════════════════════════════════════════
// STEP 21: USER EVENTS (streaming)
// ════════════════════════════════════════════════════════════════

console.log("\n🏥 Step 21: Generating user_events.csv (streaming)...");

const UE_HEADERS = [
  "event_id","customer_id","session_id","booking_id","timestamp",
  "event_type","platform","channel","properties",
];

writeCsvHeader("user_events.csv", UE_HEADERS);

let ueSeq = 1;
let ueTotal = 0;
let ueBuffer: Record<string, unknown>[] = [];

function flushUeBuffer() {
  if (ueBuffer.length === 0) return;
  writeCsvChunk("user_events.csv", UE_HEADERS, ueBuffer);
  ueTotal += ueBuffer.length;
  ueBuffer = [];
}

function addEvent(e: Record<string, unknown>) {
  e.event_id = `EVT_${String(ueSeq++).padStart(8, "0")}`;
  ueBuffer.push(e);
  if (ueBuffer.length >= 5000) flushUeBuffer();
}

function sessionId(): string {
  return `sess_${String(randInt(1, 9999999)).padStart(7, "0")}`;
}
function ueTs(date: string, hour: number, minute: number): string {
  return tsStr(date, hour, minute);
}
function randUeTs(date: string): string {
  return ueTs(date, randInt(7, 22), randInt(0, 59));
}
function uePlatform(installPlatform: string): string {
  // Slightly randomize per event but bias toward customer's platform
  return weightedPick(
    ["android","ios","web"],
    installPlatform === "android" ? [0.82, 0.05, 0.13] :
    installPlatform === "ios"     ? [0.08, 0.80, 0.12] :
                                    [0.25, 0.10, 0.65]
  );
}

// 1. BOOKING JOURNEY EVENTS
for (const booking of bookings) {
  const cust = customerById.get(booking.customer_id)!;
  const plat = uePlatform(cust.install_platform);
  const sessId = sessionId();
  const channel = booking.booking_channel;
  const bDate = booking.booking_date;
  const slotDate = booking.slot_date;
  const testSlug = bookingItemsByBooking.get(booking.booking_id)?.[0] ?? "full_body";

  // Pre-booking journey events
  if (channel.startsWith("app_")) {
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(7, 21), 0), event_type: "app_opened", platform: plat, channel, properties: JSON.stringify({ source: "direct" }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(7, 21), 2), event_type: "test_page_viewed", platform: plat, channel, properties: JSON.stringify({ test_slug: testSlug }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(7, 21), 5), event_type: "book_now_tapped", platform: plat, channel, properties: JSON.stringify({ test_slug: testSlug }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(7, 21), 7), event_type: "otp_verified", platform: plat, channel, properties: "{}" });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(7, 21), 8), event_type: "slot_selected", platform: plat, channel, properties: JSON.stringify({ slot_band: booking.slot_band, slot_date: booking.slot_date }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(7, 21), 10), event_type: "payment_completed", platform: plat, channel, properties: JSON.stringify({ method: booking.payment_method, amount: booking.total_paid_inr }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(7, 21), 11), event_type: "booking_confirmed", platform: plat, channel, properties: JSON.stringify({ booking_id: booking.booking_id }) });
  } else if (channel === "web_self_serve") {
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(8, 22), 0), event_type: "web_visit", platform: "web", channel, properties: JSON.stringify({ source: cust.acquisition_channel }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(8, 22), 2), event_type: "test_page_viewed", platform: "web", channel, properties: JSON.stringify({ test_slug: testSlug }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(8, 22), 5), event_type: "book_now_clicked", platform: "web", channel, properties: JSON.stringify({ test_slug: testSlug }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(8, 22), 8), event_type: "consumables_fee_revealed", platform: "web", channel, properties: JSON.stringify({ fee: booking.consumables_transport_fee_inr }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(8, 22), 10), event_type: "payment_completed", platform: "web", channel, properties: JSON.stringify({ method: booking.payment_method, amount: booking.total_paid_inr }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: booking.booking_id, timestamp: ueTs(bDate, randInt(8, 22), 11), event_type: "booking_confirmed", platform: "web", channel, properties: JSON.stringify({ booking_id: booking.booking_id }) });
  } else if (channel === "web_callback") {
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(8, 22), 0), event_type: "web_visit", platform: "web", channel, properties: "{}" });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(8, 22), 2), event_type: "test_page_viewed", platform: "web", channel, properties: JSON.stringify({ test_slug: testSlug }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: ueTs(bDate, randInt(8, 22), 5), event_type: "lead_form_submitted", platform: "web", channel, properties: JSON.stringify({ test_slug: testSlug }) });
  }

  // Operational chain (post-booking) for non-cancelled bookings
  if (booking.booking_status !== "cancelled" && !booking.no_show) {
    const slotHour = parseInt(booking.slot_band.split("-")[0]) || 8;
    const phlebId = assignmentByBooking.get(booking.booking_id);

    addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(tsStr(slotDate, slotHour - 1, 0), -randInt(20, 60)), event_type: "phlebotomist_assigned", platform: plat, channel, properties: JSON.stringify({ phlebotomist_id: phlebId }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: tsStr(slotDate, slotHour, randInt(0, 30)), event_type: "phlebotomist_en_route", platform: plat, channel, properties: "{}" });
    addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: tsStr(slotDate, slotHour, booking.delay_min > 0 ? booking.delay_min : randInt(2, 15)), event_type: "phlebotomist_arrived", platform: plat, channel, properties: JSON.stringify({ on_time: booking.on_time }) });
    addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: tsStr(slotDate, slotHour, booking.delay_min + randInt(8, 18)), event_type: "sample_collected", platform: plat, channel, properties: "{}" });

    if (!booking.sample_rejected) {
      addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addHours(tsStr(slotDate, slotHour, 15), booking.tat_hours * 0.3), event_type: "sample_received_at_lab", platform: plat, channel, properties: "{}" });
      addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addHours(tsStr(slotDate, slotHour, 15), booking.tat_hours), event_type: "report_generated", platform: plat, channel, properties: "{}" });
      addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addHours(tsStr(slotDate, slotHour, 15), booking.tat_hours + 0.3), event_type: "report_notification_sent", platform: plat, channel, properties: "{}" });

      if (booking.report_viewed) {
        const viewTs = addHours(tsStr(slotDate, slotHour, 15), booking.tat_hours + (booking.time_to_view_hours ?? 4));
        addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: viewTs, event_type: "report_viewed", platform: plat, channel, properties: JSON.stringify({ report_id: reportByBooking.get(booking.booking_id) }) });
        addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(viewTs, randInt(1, 8)), event_type: "health_score_viewed", platform: plat, channel, properties: "{}" });

        if (rand() < 0.42) {
          addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(viewTs, randInt(2, 15)), event_type: "abnormal_flag_clicked", platform: plat, channel, properties: "{}" });
        }
        if (booking.counseling_taken) {
          addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(viewTs, randInt(15, 60)), event_type: "counseling_started", platform: plat, channel, properties: "{}" });
          addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(viewTs, randInt(30, 90)), event_type: "counseling_completed", platform: plat, channel, properties: "{}" });
        }
        if (booking.follow_up_booked) {
          addEvent({ customer_id: cust.customer_id, session_id: sessionId(), booking_id: booking.booking_id, timestamp: addMinutes(viewTs, randInt(60, 240)), event_type: "follow_up_booked", platform: plat, channel, properties: "{}" });
        }
      }
    }
  }
}

flushUeBuffer();
console.log(`  Booking journey events: ${ueTotal.toLocaleString()}`);
const afterBookings = ueTotal;

// 2. CRM NOTIFICATION EVENTS
for (const comm of commsLog) {
  if (!(comm.delivered as boolean)) continue;
  const custId = comm.customer_id as string;
  const cust = customerById.get(custId);
  if (!cust) continue;

  addEvent({ customer_id: custId, session_id: sessionId(), booking_id: comm.booking_id, timestamp: comm.sent_at, event_type: "notification_sent", platform: comm.channel as string, channel: comm.channel as string, properties: JSON.stringify({ campaign_type: comm.campaign_type }) });

  if (comm.opened as boolean) {
    addEvent({ customer_id: custId, session_id: sessionId(), booking_id: comm.booking_id, timestamp: addMinutes(comm.sent_at as string, randInt(1, 120)), event_type: "notification_opened", platform: cust.install_platform, channel: comm.channel as string, properties: JSON.stringify({ campaign_type: comm.campaign_type }) });
  }
  if (comm.clicked as boolean) {
    addEvent({ customer_id: custId, session_id: sessionId(), booking_id: comm.booking_id, timestamp: addMinutes(comm.sent_at as string, randInt(2, 180)), event_type: "notification_clicked", platform: cust.install_platform, channel: comm.channel as string, properties: JSON.stringify({ campaign_type: comm.campaign_type }) });
  }
}

flushUeBuffer();
console.log(`  CRM notification events: ${(ueTotal - afterBookings).toLocaleString()}`);
const afterCrm = ueTotal;

// 3. BROWSE SESSIONS (~8 per customer per year)
const browseCustomers = customers.filter((_, idx) => idx % 4 === 0); // 25% of customers
for (const cust of browseCustomers) {
  const browseCount = Math.round((totalMonthCount / 12) * 8 * (rand() * 0.5 + 0.75));
  for (let i = 0; i < browseCount; i++) {
    const browseDate = randomDateBetween(DATE_START, DATE_END);
    const sessId = sessionId();
    const plat = uePlatform(cust.install_platform);
    const slug = pick(TEST_CATALOG).slug;

    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: randUeTs(browseDate), event_type: "app_opened", platform: plat, channel: "organic", properties: "{}" });
    addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: addMinutes(randUeTs(browseDate), randInt(1, 5)), event_type: "category_browsed", platform: plat, channel: "organic", properties: JSON.stringify({ category: pick(TEST_CATALOG).category }) });
    if (rand() < 0.55) {
      addEvent({ customer_id: cust.customer_id, session_id: sessId, booking_id: null, timestamp: addMinutes(randUeTs(browseDate), randInt(3, 10)), event_type: "test_page_viewed", platform: plat, channel: "organic", properties: JSON.stringify({ test_slug: slug }) });
    }
  }
}

flushUeBuffer();
console.log(`  Browse session events: ${(ueTotal - afterCrm).toLocaleString()}`);

// ════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ════════════════════════════════════════════════════════════════

console.log(`\n📊 FINAL GENERATION SUMMARY`);
console.log(`${"═".repeat(55)}`);
console.log(`  customers.csv                  ${customers.length.toLocaleString().padStart(10)} rows`);
console.log(`  customer_addresses.csv         ${customerAddresses.length.toLocaleString().padStart(10)} rows`);
console.log(`  customer_family_members.csv    ${familyMembers.length.toLocaleString().padStart(10)} rows`);
console.log(`  customer_lifestyle_profiles.csv${lifestyleProfiles.length.toLocaleString().padStart(10)} rows`);
console.log(`  phlebotomists.csv              ${phlebotomists.length.toLocaleString().padStart(10)} rows`);
console.log(`  bookings.csv                   ${bookings.length.toLocaleString().padStart(10)} rows`);
console.log(`  booking_items.csv              ${bookingItems.length.toLocaleString().padStart(10)} rows`);
console.log(`  phlebotomist_assignments.csv   ${assignments.length.toLocaleString().padStart(10)} rows`);
console.log(`  sample_tracking.csv            ${sampleTracking.length.toLocaleString().padStart(10)} rows`);
console.log(`  reports.csv                    ${reports.length.toLocaleString().padStart(10)} rows`);
console.log(`  report_results.csv             ${rrTotal.toLocaleString().padStart(10)} rows`);
console.log(`  counseling_sessions.csv        ${counselingSessions.length.toLocaleString().padStart(10)} rows`);
console.log(`  report_future_tests.csv        ${futureTests.length.toLocaleString().padStart(10)} rows`);
console.log(`  subscriptions.csv              ${subscriptions.length.toLocaleString().padStart(10)} rows`);
console.log(`  subscription_runs.csv          ${subscriptionRuns.length.toLocaleString().padStart(10)} rows`);
console.log(`  comms_log.csv                  ${commsLog.length.toLocaleString().padStart(10)} rows`);
console.log(`  nps_responses.csv              ${npsResponses.length.toLocaleString().padStart(10)} rows`);
console.log(`  phlebotomist_ratings.csv       ${phlebRatings.length.toLocaleString().padStart(10)} rows`);
console.log(`  support_tickets.csv            ${supportTickets.length.toLocaleString().padStart(10)} rows`);
console.log(`  leads.csv                      ${leads.length.toLocaleString().padStart(10)} rows`);
console.log(`  user_events.csv                ${ueTotal.toLocaleString().padStart(10)} rows`);
const totalRows = customers.length + customerAddresses.length + familyMembers.length + lifestyleProfiles.length +
  phlebotomists.length + bookings.length + bookingItems.length + assignments.length +
  sampleTracking.length + reports.length + rrTotal + counselingSessions.length +
  futureTests.length + subscriptions.length + subscriptionRuns.length + commsLog.length +
  npsResponses.length + phlebRatings.length + supportTickets.length + leads.length + ueTotal;
console.log(`${"─".repeat(55)}`);
console.log(`  TOTAL                          ${totalRows.toLocaleString().padStart(10)} rows`);

console.log("\n📌 Key Calibration Checks:");
console.log(`  On-time (metro):    ${(bookings.filter(b => b.city_tier === "metro" && b.on_time).length / Math.max(1, bookings.filter(b => b.city_tier === "metro").length) * 100).toFixed(1)}% (target 91%)`);
console.log(`  On-time (tier2):    ${(bookings.filter(b => b.city_tier === "tier2" && b.on_time).length / Math.max(1, bookings.filter(b => b.city_tier === "tier2").length) * 100).toFixed(1)}% (target 75%)`);
console.log(`  No-show (metro):    ${(bookings.filter(b => b.city_tier === "metro" && b.no_show).length / Math.max(1, bookings.filter(b => b.city_tier === "metro").length) * 100).toFixed(1)}% (target 2%)`);
console.log(`  No-show (tier2):    ${(bookings.filter(b => b.city_tier === "tier2" && b.no_show).length / Math.max(1, bookings.filter(b => b.city_tier === "tier2").length) * 100).toFixed(1)}% (target 8%)`);
console.log(`  Report viewed:      ${(bookings.filter(b => b.report_viewed).length / Math.max(1, bookings.length) * 100).toFixed(1)}% (target ~75%)`);
console.log(`  Counseling taken:   ${(bookings.filter(b => b.counseling_taken).length / Math.max(1, bookings.length) * 100).toFixed(1)}% (target ~18%)`);
console.log(`  WhatsApp opt-in:    ${(customers.filter(c => c.whatsapp_opt_in).length / customers.length * 100).toFixed(1)}% (target ~82%)`);

console.log(`\n✅ All 21 CSV files written to ${OUT_DIR}`);
console.log("   Next: npx tsx scripts/setup-healthians.ts");
