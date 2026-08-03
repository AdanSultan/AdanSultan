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

// ---------- 1. Stats card ----------

async function buildStatsCard(repos, user, prCount, issueCount) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

  const rows = [
    ['⭐ Total Stars', totalStars],
    ['🍴 Total Forks', totalForks],
    ['📦 Public Repos', user.public_repos],
    ['👥 Followers', user.followers],
    ['🔀 Pull Requests', prCount],
    ['🐛 Issues Opened', issueCount],
  ];

  const body = rows
    .map(
      ([label, value], i) => `
  <text x="25" y="${65 + i * 21}" class="label">${label}</text>
  <text x="${420 - 25}" y="${65 + i * 21}" text-anchor="end" class="value">${value}</text>`
    )
    .join('');

  const footer = `<text x="25" y="185" class="footer">Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</text>`;

  return cardShell({ title: `${USERNAME}'s GitHub Stats`, body: body + footer });
}

// ---------- 2. Streak card ----------

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
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) currentStreak++;
    else if (i === days.length - 1) continue; // aaj abhi commit nahi hua, ignore
    else break;
  }

  let longestStreak = 0;
  let running = 0;
  for (const d of days) {
    if (d.contributionCount > 0) {
      running++;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 0;
    }
  }

  return {
    total: cal.totalContributions,
    currentStreak,
    longestStreak,
  };
}

function buildStreakCard({ total, currentStreak, longestStreak }) {
  const body = `
  <text x="70" y="90" text-anchor="middle" class="value" font-size="26">${total}</text>
  <text x="70" y="112" text-anchor="middle" class="label">Total Contributions</text>

  <line x1="150" y1="60" x2="150" y2="130" stroke="#30363d"/>

  <text x="230" y="90" text-anchor="middle" class="value" font-size="26">🔥 ${currentStreak}</text>
  <text x="230" y="112" text-anchor="middle" class="label">Current Streak</text>

  <line x1="310" y1="60" x2="310" y2="130" stroke="#30363d"/>

  <text x="380" y="90" text-anchor="middle" class="value" font-size="26">${longestStreak}</text>
  <text x="380" y="112" text-anchor="middle" class="label">Longest Streak</text>

  <text x="25" y="185" class="footer">Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</text>`;

  return cardShell({ title: `${USERNAME}'s Contribution Streak`, body });
}

// ---------- 3. Top languages ----------

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

  const colors = ['#58a6ff', '#3fb950', '#f0883e', '#f778ba', '#a371f7', '#e3b341'];

  const body = sorted
    .map(([lang, bytes], i) => {
      const pct = ((bytes / total) * 100).toFixed(1);
      const barWidth = (bytes / total) * 300;
      const y = 55 + i * 24;
      return `
  <text x="25" y="${y}" class="label">${lang}</text>
  <text x="395" y="${y}" text-anchor="end" class="value">${pct}%</text>
  <rect x="25" y="${y + 5}" width="300" height="6" rx="3" fill="#30363d"/>
  <rect x="25" y="${y + 5}" width="${barWidth.toFixed(1)}" height="6" rx="3" fill="${colors[i % colors.length]}"/>`;
    })
    .join('');

  return cardShell({
    title: `${USERNAME}'s Top Languages`,
    height: 55 + sorted.length * 24 + 20,
    body,
  });
}

// ---------- 4. Trophies-style summary ----------

function buildTrophiesCard(repos, user, streakData) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const items = [
    ['🏆', totalStars, 'Stars'],
    ['📦', user.public_repos, 'Repos'],
    ['👥', user.followers, 'Followers'],
    ['🔥', streakData.currentStreak, 'Streak'],
  ];

  const boxWidth = 100;
  const body = items
    .map(([icon, value, label], i) => {
      const x = 15 + i * boxWidth;
      return `
  <rect x="${x}" y="45" width="${boxWidth - 10}" height="90" rx="8" fill="#161b22" stroke="#30363d"/>
  <text x="${x + (boxWidth - 10) / 2}" y="80" text-anchor="middle" font-size="24">${icon}</text>
  <text x="${x + (boxWidth - 10) / 2}" y="105" text-anchor="middle" class="value" font-size="16">${value}</text>
  <text x="${x + (boxWidth - 10) / 2}" y="122" text-anchor="middle" class="label" font-size="11">${label}</text>`;
    })
    .join('');

  return cardShell({ title: `${USERNAME}'s Trophies`, height: 150, body });
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
  const stats = await buildStatsCard(repos, user, prSearch.total_count, issueSearch.total_count);
  const streak = buildStreakCard(streakData);
  const topLangs = await buildTopLangsCard(repos);
  const trophies = buildTrophiesCard(repos, user, streakData);
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
