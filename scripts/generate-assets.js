// scripts/generate-assets.js
//
// Yeh script GitHub REST + GraphQL API se seedha data khinchta hai
// aur assets/*.svg files khud generate karta hai. Koi third-party
// badge service (shion.dev / demolab / vercel readme-stats) use
// nahi hoti — isliye caching ka masla khatam.
//
// Run: node scripts/generate-assets.js
// Requires env: GH_TOKEN, GH_USERNAME

const fs = require('fs');
const path = require('path');

const USERNAME = process.env.GH_USERNAME || 'AdanSultan';
const TOKEN = process.env.GH_TOKEN;
const ASSETS_DIR = path.join(process.cwd(), 'assets');

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ---------- helpers ----------

async function ghFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USERNAME,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} — ${url}`);
  return res.json();
}

async function ghGraphQL(query) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json;
}

async function getAllRepos() {
  let page = 1;
  let all = [];
  while (true) {
    const repos = await ghFetch(
      `https://api.github.com/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`
    );
    all = all.concat(repos);
    if (repos.length < 100) break;
    page++;
  }
  return all;
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxCharsPerLine) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------- SVG card shell (dark theme, matches previous badge look) ----------

function cardShell({ width = 420, height = 195, title, body, titleColor = '#58a6ff', borderColor = '#30363d', borderWidth = 1, bgColor = '#0d1117' }) {
  const titleText = title ? `<text x="25" y="35" fill="${titleColor}" style="font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif;">${title}</text>` : '';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .label { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .value { font: 700 15px 'Segoe UI', Ubuntu, Sans-Serif; fill: #ffffff; }
    .footer { font: 400 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: #6e7681; }
  </style>
  <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="10" fill="${bgColor}" stroke="${borderColor}" stroke-width="${borderWidth}"/>
  ${titleText}
  ${body}
</svg>`;
}

// ---------- date helpers ----------

function formatShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---------- 1. Stats card (with grade ring) ----------

function calcGrade({ totalStars, totalCommits, followers, publicRepos }) {
  const score = totalStars * 3 + totalCommits * 0.7 + followers * 2 + publicRepos * 1.5;
  if (score >= 1000) return { letter: 'S', pct: 100 };
  if (score >= 500) return { letter: 'A+', pct: 90 };
  if (score >= 250) return { letter: 'A', pct: 75 };
  if (score >= 120) return { letter: 'B+', pct: 60 };
  if (score >= 60) return { letter: 'B', pct: 45 };
  if (score >= 25) return { letter: 'C+', pct: 30 };
  return { letter: 'C', pct: 15 };
}

async function buildStatsCard(repos, user, prCount, issueCount, totalCommits) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const displayName = user.name || USERNAME;
  const grade = calcGrade({ totalStars, totalCommits, followers: user.followers, publicRepos: user.public_repos });

  const rows = [
    ['Total Stars Earned', totalStars],
    ['Total Commits (last year)', totalCommits],
    ['Total PRs', prCount],
    ['Total Issues', issueCount],
    ['Public Repos', user.public_repos],
  ];

  const body = rows
    .map(
      ([label, value], i) => `
  <text x="25" y="${68 + i * 20}" class="label">${label}:</text>
  <text x="270" y="${68 + i * 20}" class="value">${value}</text>`
    )
    .join('');

  // grade ring top-right
  const cx = 365, cy = 100, r = 34;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - grade.pct / 100);
  const ring = `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#30363d" stroke-width="5"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f0883e" stroke-width="5"
    stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"
    stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy + 7}" text-anchor="middle" font-size="20" font-weight="700" fill="#f0883e">${grade.letter}</text>`;

  const footer = `<text x="25" y="185" class="footer">Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</text>`;

  return cardShell({
    title: `${displayName}'s GitHub Stats`,
    body: body + ring + footer,
    titleColor: '#ffffff',
    bgColor: '#080a0c',
    borderColor: '#e6edf3',
    borderWidth: 2.5,
  });
}

// ---------- 2. Streak card (circular flame + date ranges) ----------

async function getContributionData() {
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount }
            }
          }
        }
      }
    }`;
  const data = await ghGraphQL(query);
  const cal = data.data.user.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) => w.contributionDays);

  let currentStreak = 0;
  let currentStreakEndDate = days[days.length - 1].date;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      currentStreak++;
      currentStreakEndDate = days[i].date;
    } else if (i === days.length - 1) {
      continue; // aaj abhi commit nahi hua, ignore aur peeche dekho
    } else {
      break;
    }
  }

  let longestStreak = 0;
  let running = 0;
  let runStart = null;
  let bestStart = days[0].date;
  let bestEnd = days[0].date;
  for (const d of days) {
    if (d.contributionCount > 0) {
      if (running === 0) runStart = d.date;
      running++;
      if (running > longestStreak) {
        longestStreak = running;
        bestStart = runStart;
        bestEnd = d.date;
      }
    } else {
      running = 0;
    }
  }

  return {
    total: cal.totalContributions,
    currentStreak,
    longestStreak,
    firstDate: days[0].date,
    currentStreakEndDate,
    longestStreakStart: bestStart,
    longestStreakEnd: bestEnd,
  };
}

function buildStreakCard(data) {
  const { total, currentStreak, longestStreak } = data;

  const flameCx = 210, flameCy = 85, flameR = 40;
  const circumference = 2 * Math.PI * flameR;

  const body = `
  <text x="70" y="75" text-anchor="middle" class="value" font-size="28">${total}</text>
  <text x="70" y="98" text-anchor="middle" class="label">Total Contributions</text>
  <text x="70" y="115" text-anchor="middle" class="footer">${formatLong(data.firstDate)} - Present</text>

  <circle cx="${flameCx}" cy="${flameCy}" r="${flameR}" fill="none" stroke="#f0883e" stroke-width="4"/>
  <text x="${flameCx}" y="${flameCy - 2}" text-anchor="middle" font-size="20">🔥</text>
  <text x="${flameCx}" y="${flameCy + 18}" text-anchor="middle" class="value" font-size="16">${currentStreak}</text>
  <text x="${flameCx}" y="${flameCy + 55}" text-anchor="middle" class="label" fill="#f0883e">Current Streak</text>
  <text x="${flameCx}" y="${flameCy + 70}" text-anchor="middle" class="footer">${formatShort(data.currentStreakEndDate)}</text>

  <text x="350" y="75" text-anchor="middle" class="value" font-size="28">${longestStreak}</text>
  <text x="350" y="98" text-anchor="middle" class="label">Longest Streak</text>
  <text x="350" y="115" text-anchor="middle" class="footer">${formatShort(data.longestStreakStart)} - ${formatShort(data.longestStreakEnd)}</text>

  <line x1="140" y1="45" x2="140" y2="135" stroke="#30363d"/>
  <line x1="280" y1="45" x2="280" y2="135" stroke="#30363d"/>

  <text x="25" y="185" class="footer">Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</text>`;

  return cardShell({
    title: `Contribution Streak`,
    body,
    titleColor: '#ffffff',
    bgColor: '#080a0c',
    borderColor: '#e6edf3',
    borderWidth: 2.5,
  });
}

// ---------- 3. Top languages (single bar + colored dot legend) ----------

const LANGUAGE_COLORS = {
  'Jupyter Notebook': '#DA5B0B',
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  HTML: '#e34c26',
  CSS: '#563d7c',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Go: '#00ADD8',
  Rust: '#dea584',
  Shell: '#89e051',
  Dockerfile: '#384d54',
  Vue: '#41b883',
  SCSS: '#c6538c',
};
const FALLBACK_COLORS = ['#58a6ff', '#3fb950', '#f778ba', '#a371f7', '#e3b341', '#79c0ff'];

async function buildTopLangsCard(repos) {
  const langTotals = {};
  for (const repo of repos) {
    if (repo.fork) continue;
    try {
      const langs = await ghFetch(repo.languages_url);
      for (const [lang, bytes] of Object.entries(langs)) {
        langTotals[lang] = (langTotals[lang] || 0) + bytes;
      }
    } catch (e) {
      // skip repo agar languages fetch fail ho
    }
  }

  const sorted = Object.entries(langTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const colorFor = (lang, i) => LANGUAGE_COLORS[lang] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];

  // ek hi stacked bar
  let xCursor = 25;
  const barY = 55, barW = 370, barH = 10;
  const barSegments = sorted
    .map(([lang, bytes], i) => {
      const segW = (bytes / total) * barW;
      const rect = `<rect x="${xCursor.toFixed(1)}" y="${barY}" width="${segW.toFixed(1)}" height="${barH}" fill="${colorFor(lang, i)}"/>`;
      xCursor += segW;
      return rect;
    })
    .join('');

  // 2-column legend, colored dots
  const legendStartY = 95;
  const rowGap = 22;
  const legend = sorted
    .map(([lang, bytes], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col === 0 ? 25 : 220;
      const y = legendStartY + row * rowGap;
      const pct = ((bytes / total) * 100).toFixed(2);
      return `
  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${colorFor(lang, i)}"/>
  <text x="${x + 18}" y="${y}" class="label" font-size="12">${lang} ${pct}%</text>`;
    })
    .join('');

  const legendRows = Math.ceil(sorted.length / 2);
  const height = legendStartY + legendRows * rowGap + 20;

  return cardShell({
    title: `Most Used Languages`,
    height,
    body: `<rect x="25" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="#30363d"/>${barSegments}${legend}`,
    titleColor: '#ffffff',
    bgColor: '#080a0c',
    borderColor: '#e6edf3',
    borderWidth: 2.5,
  });
}

// ---------- 4. Trophies (S/A/B/C rank badges, like classic profile-trophy) ----------

const TROPHY_TIER_COLOR = { S: '#39d353', A: '#58a6ff', B: '#a371f7', C: '#8b949e' };

const TROPHY_LABELS = {
  Stars: { S: 'Stargazer', A: 'Star Collector', B: 'Star Hunter', C: 'First Star' },
  Commit: { S: 'Commit God', A: 'Ultra Committer', B: 'Active Committer', C: 'First Commit' },
  Followers: { S: 'Influencer', A: 'Dynamic User', B: 'Growing User', C: 'First Follower' },
  Issues: { S: 'Issue Master', A: 'High Issuer', B: 'Casual Issuer', C: 'First Issue' },
  PullRequest: { S: 'PR Master', A: 'Senior PR User', B: 'Middle PR User', C: 'First PR' },
  Repositories: { S: 'Repo Master', A: 'Repo Collector', B: 'Repo Builder', C: 'First Repository' },
};

function rankFor(value, [sMin, aMin, bMin]) {
  if (value >= sMin) return 'S';
  if (value >= aMin) return 'A';
  if (value >= bMin) return 'B';
  return 'C';
}

// Draws a trophy cup (bowl + handles + stem + base) inside a 50-wide box
// whose top-left corner is (x, y). Colored entirely in `color`.
function trophyCup(x, y, color) {
  return `
  <path d="M${x + 5},${y + 2} H${x + 45} V${y + 14} Q${x + 45},${y + 34} ${x + 25},${y + 34} Q${x + 5},${y + 34} ${x + 5},${y + 14} Z" fill="${color}"/>
  <path d="M${x + 5},${y + 8} Q${x - 9},${y + 8} ${x - 9},${y + 18} Q${x - 9},${y + 27} ${x + 5},${y + 25}" fill="none" stroke="${color}" stroke-width="3.5"/>
  <path d="M${x + 45},${y + 8} Q${x + 59},${y + 8} ${x + 59},${y + 18} Q${x + 59},${y + 27} ${x + 45},${y + 25}" fill="none" stroke="${color}" stroke-width="3.5"/>
  <rect x="${x + 21}" y="${y + 34}" width="8" height="9" fill="${color}"/>
  <rect x="${x + 9}" y="${y + 43}" width="32" height="5" rx="2" fill="${color}"/>
  <!-- laurel leaves either side of the cup -->
  <text x="${x - 16}" y="${y + 24}" font-size="15">🌿</text>
  <text x="${x + 66}" y="${y + 24}" font-size="15" transform="scale(-1,1) translate(${-2 * (x + 66)},0)">🌿</text>`;
}

function buildTrophiesCard(repos, user, prCount, issueCount, totalCommits) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

  const categories = [
    { name: 'Stars', value: totalStars, thresholds: [50, 10, 3] },
    { name: 'Commit', value: totalCommits, thresholds: [1000, 200, 50] },
    { name: 'Followers', value: user.followers, thresholds: [500, 20, 5] },
    { name: 'Issues', value: issueCount, thresholds: [200, 20, 5] },
    { name: 'PullRequest', value: prCount, thresholds: [200, 20, 5] },
    { name: 'Repositories', value: user.public_repos, thresholds: [50, 15, 5] },
  ];

  const colW = 150, gap = 8, contentTop = 20, boxH = 220, cardHeight = contentTop + boxH + 15;
  const width = 20 + categories.length * colW + (categories.length - 1) * gap + 20;
  const labelColor = '#f06595'; // pink/coral for label + points, matches reference
  const barColor = '#d4a017'; // gold progress bar

  const body = categories
    .map((cat, i) => {
      const rank = rankFor(cat.value, cat.thresholds);
      const color = TROPHY_TIER_COLOR[rank];
      const label = TROPHY_LABELS[cat.name][rank];
      const x0 = 20 + i * (colW + gap);
      const cx = x0 + colW / 2;
      const cupX = cx - 25;
      const cupY = contentTop + 40;
      const barFrac = Math.max(0.08, Math.min(cat.value / cat.thresholds[0], 1));
      const barTrackW = 60;
      const barFillW = (barTrackW * barFrac).toFixed(1);

      return `
  <rect x="${x0}" y="${contentTop}" width="${colW}" height="${boxH}" rx="10" fill="#161b22" stroke="${color}" stroke-width="2.5"/>
  <text x="${cx}" y="${contentTop + 25}" text-anchor="middle" font-size="14" font-weight="700" fill="${color}">${cat.name}</text>
  ${trophyCup(cupX, cupY, color)}
  <circle cx="${cx}" cy="${cupY + 16}" r="15" fill="#161b22" stroke="${color}" stroke-width="3"/>
  <text x="${cx}" y="${cupY + 21}" text-anchor="middle" font-size="15" font-weight="700" fill="${color}">${rank}</text>
  <text x="${cx}" y="${contentTop + 148}" text-anchor="middle" font-size="12" font-weight="700" fill="${labelColor}">${label}</text>
  <text x="${cx}" y="${contentTop + 166}" text-anchor="middle" font-size="13" font-weight="700" fill="${labelColor}">${cat.value}pt</text>
  <rect x="${(cx - barTrackW / 2).toFixed(1)}" y="${contentTop + 178}" width="${barTrackW}" height="4" rx="2" fill="#0d1117"/>
  <rect x="${(cx - barTrackW / 2).toFixed(1)}" y="${contentTop + 178}" width="${barFillW}" height="4" rx="2" fill="${barColor}"/>`;
    })
    .join('');

  return cardShell({ width, height: cardHeight, body });
}

// ---------- 5. Random quote ----------

// Bade fallback pool taake agar API fail/slow ho ya same quote repeat ho,
// tab bhi variety mile — random index se pick hota hai.
const FALLBACK_QUOTES = [
  ['Code is like humor. When you have to explain it, it’s bad.', 'Cory House'],
  ['First, solve the problem. Then, write the code.', 'John Johnson'],
  ['Experience is the name everyone gives to their mistakes.', 'Oscar Wilde'],
  ['In order to be irreplaceable, one must always be different.', 'Coco Chanel'],
  ['Java is to JavaScript what car is to Carpet.', 'Chris Heilmann'],
  ['Knowledge is power.', 'Francis Bacon'],
  ['Sometimes it pays to stay in bed on Monday.', 'Bob Marley'],
  ['Simplicity is the soul of efficiency.', 'Austin Freeman'],
  ['Before software can be reusable it first has to be usable.', 'Ralph Johnson'],
  ['Programs must be written for people to read.', 'Harold Abelson'],
  ['The best error message is the one that never shows up.', 'Thomas Fuchs'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['Make it work, make it right, make it fast.', 'Kent Beck'],
  ['Any fool can write code a computer can understand.', 'Martin Fowler'],
  ['Premature optimization is the root of all evil.', 'Donald Knuth'],
];

async function buildQuoteCard() {
  let quote, author;

  try {
    // cache-buster query param taake fresh response mile, purana cached na aaye
    const res = await fetch(`https://zenquotes.io/api/random?_=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && data[0].q) {
        quote = data[0].q;
        author = data[0].a;
      }
    }
  } catch (e) {
    // fetch fail ho to neeche fallback list se random pick hoga
  }

  if (!quote) {
    const pick = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
    quote = pick[0];
    author = pick[1];
  }

  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = wrapText(quote, 52);
  const width = 420;

  const quoteLines = lines
    .map((line, i) => {
      const prefix = i === 0 ? '\u201c' : '';
      const suffix = i === lines.length - 1 ? '\u201d' : '';
      return `<text x="25" y="${45 + i * 24}" font-size="14" font-style="italic" font-weight="600" fill="#7ee8c7">${prefix}${escape(line)}${suffix}</text>`;
    })
    .join('');

  const authorY = 45 + lines.length * 24 + 28;
  const authorLine = `<text x="${width - 25}" y="${authorY}" text-anchor="end" font-size="13" font-style="italic" fill="#f06595">- ${escape(author)}</text>`;

  const boxHeight = 45 + lines.length * 24 + 45;
  const box = `<rect x="20" y="15" width="${width - 40}" height="${boxHeight}" rx="10" fill="#161b22"/>`;

  return cardShell({
    width,
    height: boxHeight + 30,
    body: box + quoteLines + authorLine,
  });
}

// ---------- 6. Top repos (replaces "top contributed repo" widget) ----------

function buildTopReposCard(repos) {
  const top = [...repos]
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 5);

  const body = top
    .map(
      (r, i) => `
  <text x="25" y="${60 + i * 22}" class="label">${r.name}</text>
  <text x="395" y="${60 + i * 22}" text-anchor="end" class="value">⭐ ${r.stargazers_count}</text>`
    )
    .join('');

  return cardShell({
    title: `${USERNAME}'s Top Repositories`,
    height: 60 + top.length * 22 + 20,
    body,
  });
}

// ---------- main ----------

async function main() {
  if (!TOKEN) throw new Error('GH_TOKEN missing.');

  console.log('Fetching user + repos...');
  const user = await ghFetch(`https://api.github.com/users/${USERNAME}`);
  const repos = await getAllRepos();

  console.log('Fetching PR / issue counts...');
  const prSearch = await ghFetch(
    `https://api.github.com/search/issues?q=type:pr+author:${USERNAME}`
  );
  const issueSearch = await ghFetch(
    `https://api.github.com/search/issues?q=type:issue+author:${USERNAME}`
  );

  console.log('Fetching contribution calendar...');
  const streakData = await getContributionData();

  console.log('Building cards...');
  const stats = await buildStatsCard(repos, user, prSearch.total_count, issueSearch.total_count, streakData.total);
  const streak = buildStreakCard(streakData);
  const topLangs = await buildTopLangsCard(repos);
  const trophies = buildTrophiesCard(repos, user, prSearch.total_count, issueSearch.total_count, streakData.total);
  const quote = await buildQuoteCard();
  const topRepos = buildTopReposCard(repos);

  fs.writeFileSync(path.join(ASSETS_DIR, 'stats.svg'), stats);
  fs.writeFileSync(path.join(ASSETS_DIR, 'streak.svg'), streak);
  fs.writeFileSync(path.join(ASSETS_DIR, 'top-langs.svg'), topLangs);
  fs.writeFileSync(path.join(ASSETS_DIR, 'trophies.svg'), trophies);
  fs.writeFileSync(path.join(ASSETS_DIR, 'quote.svg'), quote);
  fs.writeFileSync(path.join(ASSETS_DIR, 'top-repos.svg'), topRepos);

  console.log('All assets generated successfully in /assets');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
