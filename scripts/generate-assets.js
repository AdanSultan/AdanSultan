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

function cardShell({ width = 420, height = 195, title, body }) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: #58a6ff; }
    .label { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .value { font: 600 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #ffffff; }
    .footer { font: 400 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: #6e7681; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="#0d1117" stroke="#30363d"/>
  <text x="25" y="35" class="title">${title}</text>
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
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#58a6ff" stroke-width="5"
    stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"
    stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy + 7}" text-anchor="middle" class="value" font-size="20">${grade.letter}</text>`;

  const footer = `<text x="25" y="185" class="footer">Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</text>`;

  return cardShell({ title: `${displayName}'s GitHub Stats`, body: body + ring + footer });
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

  return cardShell({ title: `Contribution Streak`, body });
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

  const boxW = 110, gap = 12, boxY = 50, boxH = 110;
  const width = 20 * 2 + categories.length * boxW + (categories.length - 1) * gap;

  const body = categories
    .map((cat, i) => {
      const rank = rankFor(cat.value, cat.thresholds);
      const color = TROPHY_TIER_COLOR[rank];
      const label = TROPHY_LABELS[cat.name][rank];
      const bx = 20 + i * (boxW + gap);
      const cx = bx + boxW / 2;
      const cy = boxY + 55;

      return `
  <rect x="${bx}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="#161b22" stroke="${color}" stroke-width="2"/>
  <text x="${cx}" y="${boxY + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="${color}">${cat.name}</text>
  <text x="${cx - 26}" y="${cy + 5}" text-anchor="middle" font-size="14">🌿</text>
  <circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="${color}" stroke-width="3"/>
  <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="700" fill="${color}">${rank}</text>
  <text x="${cx + 26}" y="${cy + 5}" text-anchor="middle" font-size="14">🌿</text>
  <text x="${cx}" y="${boxY + 90}" text-anchor="middle" font-size="9" fill="#c9d1d9">${label}</text>
  <text x="${cx}" y="${boxY + 103}" text-anchor="middle" font-size="11" font-weight="600" fill="#ffffff">${cat.value}pt</text>`;
    })
    .join('');

  return cardShell({ title: 'GitHub Trophies', width, height: boxY + boxH + 15, body });
}

// ---------- 5. Random quote ----------

async function buildQuoteCard() {
  let quote = 'Code is like humor. When you have to explain it, it’s bad.';
  let author = 'Cory House';
  try {
    const res = await fetch('https://zenquotes.io/api/random');
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        quote = data[0].q;
        author = data[0].a;
      }
    }
  } catch (e) {
    // fetch fail ho to fallback quote use hoga
  }

  const lines = wrapText(quote, 55);
  const body = lines
    .map((line, i) => `<text x="25" y="${70 + i * 20}" class="value" font-style="italic">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`)
    .join('');
  const authorLine = `<text x="25" y="${70 + lines.length * 20 + 15}" class="label">— ${author}</text>`;

  return cardShell({
    title: '💬 Random Dev Quote',
    height: 70 + lines.length * 20 + 45,
    body: body + authorLine,
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
