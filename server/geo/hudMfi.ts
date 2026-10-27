// HUD FY2025 4-person Median Family Income (AMI) for the counties of the largest metros/HMFAs,
// keyed by 5-digit state+county FIPS. Bundled approximations of HUD's published table — the
// geo agent prefers these over ACS county median family income, which is a looser proxy.

interface Mfi { area: string; mfi: number }

const AREAS: [string, number, string[]][] = [
  ["New York, NY HUD Metro FMR Area", 162000, ["36005", "36047", "36061", "36081", "36085", "36079", "36087"]],
  ["Nassau-Suffolk, NY HMFA", 163900, ["36059", "36103"]],
  ["Oakland-Fremont, CA HMFA", 150000, ["06001", "06013"]],
  ["San Francisco, CA HMFA", 186600, ["06075", "06081", "06041"]],
  ["San Jose-Sunnyvale-Santa Clara, CA HMFA", 195200, ["06085"]],
  ["Los Angeles-Long Beach-Glendale, CA HMFA", 106600, ["06037"]],
  ["Anaheim-Santa Ana-Irvine, CA HMFA", 136600, ["06059"]],
  ["San Diego-Carlsbad, CA MSA", 130800, ["06073"]],
  ["Sacramento-Roseville-Arden-Arcade, CA HMFA", 118600, ["06067", "06061", "06113", "06017"]],
  ["Riverside-San Bernardino-Ontario, CA MSA", 103900, ["06065", "06071"]],
  ["Seattle-Bellevue, WA HMFA", 160400, ["53033", "53061"]],
  ["Tacoma, WA HMFA", 124300, ["53053"]],
  ["Portland-Vancouver-Hillsboro, OR-WA MSA", 124000, ["41051", "41067", "41005", "53011"]],
  ["Chicago-Joliet-Naperville, IL HMFA", 119500, ["17031", "17043", "17097", "17197", "17089", "17111"]],
  ["Houston-The Woodlands-Sugar Land, TX HMFA", 97500, ["48201", "48157", "48339", "48039"]],
  ["Dallas, TX HMFA", 116800, ["48113", "48085", "48121", "48397", "48257"]],
  ["Fort Worth-Arlington, TX HMFA", 106300, ["48439", "48251", "48367"]],
  ["Austin-Round Rock, TX MSA", 126000, ["48453", "48491", "48209"]],
  ["San Antonio-New Braunfels, TX HMFA", 95100, ["48029", "48091", "48187"]],
  ["Phoenix-Mesa-Scottsdale, AZ MSA", 103100, ["04013", "04021"]],
  ["Philadelphia-Camden-Wilmington MSA", 124600, ["42101", "42045", "42091", "42017"]],
  ["Pittsburgh, PA HMFA", 106000, ["42003"]],
  ["Washington-Arlington-Alexandria, DC-VA-MD HMFA", 154700, ["11001", "24031", "24033", "51013", "51059", "51510", "51107"]],
  ["Baltimore-Columbia-Towson, MD MSA", 128400, ["24510", "24005", "24003", "24027"]],
  ["Boston-Cambridge-Quincy, MA-NH HMFA", 160900, ["25025", "25017", "25021", "25009", "25023"]],
  ["Miami-Miami Beach-Kendall, FL HMFA", 89600, ["12086"]],
  ["Fort Lauderdale, FL HMFA", 102800, ["12011"]],
  ["West Palm Beach-Boca Raton, FL HMFA", 111300, ["12099"]],
  ["Orlando-Kissimmee-Sanford, FL MSA", 100200, ["12095", "12097", "12117"]],
  ["Tampa-St. Petersburg-Clearwater, FL MSA", 99500, ["12057", "12103", "12101"]],
  ["Atlanta-Sandy Springs-Roswell, GA HMFA", 110300, ["13121", "13089", "13067", "13135", "13063"]],
  ["Denver-Aurora-Lakewood, CO HMFA", 133200, ["08031", "08005", "08001", "08059", "08035"]],
  ["Minneapolis-St. Paul-Bloomington, MN-WI HMFA", 131600, ["27053", "27123", "27037", "27003"]],
  ["Detroit-Warren-Livonia, MI HMFA", 98600, ["26163", "26125", "26099"]],
  ["Las Vegas-Henderson-Paradise, NV MSA", 91700, ["32003"]],
  ["Charlotte-Concord-Gastonia, NC-SC HMFA", 112200, ["37119", "37179"]],
  ["Raleigh, NC MSA", 130000, ["37183", "37101"]],
  ["Nashville-Davidson--Murfreesboro--Franklin, TN HMFA", 113600, ["47037", "47149", "47187"]],
  ["Columbus, OH HMFA", 108300, ["39049", "39041"]],
  ["Cleveland-Elyria, OH MSA", 96100, ["39035", "39093"]],
  ["Cincinnati, OH-KY-IN HMFA", 105600, ["39061"]],
  ["Salt Lake City, UT HMFA", 117100, ["49035"]],
  ["Kansas City, MO-KS HMFA", 108300, ["29095", "20091", "20209"]],
  ["St. Louis, MO-IL HMFA", 112100, ["29510", "29189"]],
  ["Indianapolis-Carmel, IN HMFA", 99200, ["18097", "18057"]],
  ["Newark, NJ HMFA", 136000, ["34013", "34027", "34039"]],
];

const BY_FIPS = new Map<string, Mfi>();
for (const [area, mfi, counties] of AREAS) for (const c of counties) BY_FIPS.set(c, { area, mfi });

export function hudMfiForCounty(stateFips: string, countyFips: string): Mfi | null {
  return BY_FIPS.get(`${stateFips}${countyFips}`) ?? null;
}
