#!/usr/bin/env node
/**
 * GitHub Community Analytics for Maestro
 *
 * Fetches stargazers and forkers with detailed user data for analytics.
 * Requires: gh CLI to be installed and authenticated.
 *
 * Usage:
 *   node github-community-analytics.js
 *   node github-community-analytics.js --fetch-details  # Also fetch user details (slower)
 *   node github-community-analytics.js --json           # Output as JSON
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'pedramamini/Maestro';
const OUTPUT_DIR = path.join(__dirname, '..', 'community-data');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function ghApi(endpoint, extraHeaders = []) {
  const args = ['api', '--paginate'];
  extraHeaders.forEach(h => {
    args.push('-H', h);
  });
  args.push(endpoint);

  try {
    const result = execFileSync('gh', args, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large responses
    });
    // Paginated results come as newline-separated JSON arrays
    const lines = result.trim().split('\n').filter(Boolean);
    if (lines.length === 1) {
      return JSON.parse(lines[0]);
    }
    return lines.flatMap(line => JSON.parse(line));
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message);
    return [];
  }
}

function ghApiSingle(endpoint) {
  try {
    const result = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf-8',
    });
    return JSON.parse(result);
  } catch (error) {
    return null;
  }
}

function fetchStargazers() {
  console.log('Fetching stargazers with timestamps...');
  const data = ghApi(
    `repos/${REPO}/stargazers`,
    ['Accept: application/vnd.github.star+json']
  );

  return data.map(item => ({
    username: item.user.login,
    userId: item.user.id,
    profileUrl: item.user.html_url,
    avatarUrl: item.user.avatar_url,
    starredAt: item.starred_at,
    type: item.user.type,
  }));
}

function fetchForkers() {
  console.log('Fetching forkers...');
  const data = ghApi(`repos/${REPO}/forks`);

  return data.map(fork => ({
    username: fork.owner.login,
    userId: fork.owner.id,
    profileUrl: fork.owner.html_url,
    avatarUrl: fork.owner.avatar_url,
    forkedAt: fork.created_at,
    forkName: fork.full_name,
    forkUrl: fork.html_url,
    type: fork.owner.type,
  }));
}

function fetchUserDetails(username) {
  const user = ghApiSingle(`users/${username}`);
  if (!user) {
    console.error(`  Failed to fetch details for ${username}`);
    return null;
  }
  return {
    username: user.login,
    name: user.name,
    company: user.company,
    location: user.location,
    email: user.email,
    bio: user.bio,
    blog: user.blog,
    twitterUsername: user.twitter_username,
    followers: user.followers,
    following: user.following,
    publicRepos: user.public_repos,
    publicGists: user.public_gists,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function generateGrowthTimeline(items, dateField) {
  const byDate = {};
  items.forEach(item => {
    const date = item[dateField]?.split('T')[0];
    if (date) {
      byDate[date] = (byDate[date] || 0) + 1;
    }
  });

  const sorted = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  let cumulative = 0;
  return sorted.map(([date, count]) => {
    cumulative += count;
    return { date, dailyCount: count, cumulative };
  });
}

function generateReport(stargazers, forkers, userDetails = null) {
  const uniqueUsers = new Set([
    ...stargazers.map(s => s.username),
    ...forkers.map(f => f.username),
  ]);

  const starGrowth = generateGrowthTimeline(stargazers, 'starredAt');
  const forkGrowth = generateGrowthTimeline(forkers, 'forkedAt');

  // Users who both starred and forked
  const starUsernames = new Set(stargazers.map(s => s.username));
  const forkUsernames = new Set(forkers.map(f => f.username));
  const engagedUsers = [...starUsernames].filter(u => forkUsernames.has(u));

  const report = {
    generatedAt: new Date().toISOString(),
    repository: REPO,
    summary: {
      totalStars: stargazers.length,
      totalForks: forkers.length,
      uniqueUsers: uniqueUsers.size,
      highlyEngagedUsers: engagedUsers.length,
    },
    starGrowth,
    forkGrowth,
    engagedUsers,
    recentStars: stargazers
      .sort((a, b) => new Date(b.starredAt) - new Date(a.starredAt))
      .slice(0, 10),
    recentForks: forkers
      .sort((a, b) => new Date(b.forkedAt) - new Date(a.forkedAt))
      .slice(0, 10),
  };

  if (userDetails) {
    // Add location distribution
    const locations = {};
    const companies = {};
    let totalFollowers = 0;

    Object.values(userDetails).forEach(user => {
      if (user) {
        if (user.location) {
          locations[user.location] = (locations[user.location] || 0) + 1;
        }
        if (user.company) {
          companies[user.company] = (companies[user.company] || 0) + 1;
        }
        totalFollowers += user.followers || 0;
      }
    });

    report.demographics = {
      topLocations: Object.entries(locations)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
      topCompanies: Object.entries(companies)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
      totalCommunityFollowers: totalFollowers,
    };

    // Top influencers (by follower count)
    report.topInfluencers = Object.values(userDetails)
      .filter(u => u)
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 20)
      .map(u => ({
        username: u.username,
        name: u.name,
        followers: u.followers,
        company: u.company,
      }));
  }

  return report;
}

function generateMarkdownReport(report) {
  let md = `# Maestro Community Analytics

**Generated:** ${report.generatedAt}
**Repository:** [${report.repository}](https://github.com/${report.repository})

## Summary

| Metric | Count |
|--------|-------|
| Total Stars | ${report.summary.totalStars} |
| Total Forks | ${report.summary.totalForks} |
| Unique Community Members | ${report.summary.uniqueUsers} |
| Highly Engaged (starred + forked) | ${report.summary.highlyEngagedUsers} |

## Highly Engaged Users

These users both starred AND forked the repository:

${report.engagedUsers.map(u => `- [@${u}](https://github.com/${u})`).join('\n')}

## Recent Stars (Last 10)

| User | Starred At |
|------|------------|
${report.recentStars.map(s => `| [@${s.username}](${s.profileUrl}) | ${s.starredAt?.split('T')[0] || 'N/A'} |`).join('\n')}

## Recent Forks (Last 10)

| User | Forked At | Fork |
|------|-----------|------|
${report.recentForks.map(f => `| [@${f.username}](${f.profileUrl}) | ${f.forkedAt?.split('T')[0] || 'N/A'} | [${f.forkName}](${f.forkUrl}) |`).join('\n')}

## Star Growth Over Time

| Date | Daily | Cumulative |
|------|-------|------------|
${report.starGrowth.slice(-30).map(g => `| ${g.date} | +${g.dailyCount} | ${g.cumulative} |`).join('\n')}

## Fork Growth Over Time

| Date | Daily | Cumulative |
|------|-------|------------|
${report.forkGrowth.slice(-30).map(g => `| ${g.date} | +${g.dailyCount} | ${g.cumulative} |`).join('\n')}
`;

  if (report.demographics) {
    md += `
## Demographics

### Top Locations
${report.demographics.topLocations.map(([loc, count]) => `- ${loc}: ${count}`).join('\n')}

### Top Companies
${report.demographics.topCompanies.map(([co, count]) => `- ${co}: ${count}`).join('\n')}

### Top Influencers (by follower count)
| User | Name | Followers | Company |
|------|------|-----------|---------|
${report.topInfluencers.map(u => `| [@${u.username}](https://github.com/${u.username}) | ${u.name || ''} | ${u.followers} | ${u.company || ''} |`).join('\n')}

**Total Community Reach:** ${report.demographics.totalCommunityFollowers.toLocaleString()} followers
`;
  }

  return md;
}

function generateHtmlDashboard(report, stargazers, forkers, userDetails) {
  const embeddedData = {
    report,
    stargazers,
    forkers,
    userDetails: userDetails || {}
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maestro Community Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 24px;
      min-height: 100vh;
    }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { font-size: 2.5rem; color: #58a6ff; margin-bottom: 8px; }
    .header p { color: #8b949e; font-size: 0.9rem; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .stat-card .value { font-size: 2.5rem; font-weight: bold; color: #58a6ff; }
    .stat-card .label { color: #8b949e; margin-top: 4px; }
    .stat-card.stars .value { color: #f0c14b; }
    .stat-card.forks .value { color: #a371f7; }
    .stat-card.users .value { color: #3fb950; }
    .stat-card.reach .value { color: #ff7b72; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    .chart-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 24px;
    }
    .chart-card h3 { margin-bottom: 16px; color: #c9d1d9; }
    .chart-container { position: relative; height: 300px; }
    .tables-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
    }
    .table-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 24px;
      max-height: 500px;
      overflow-y: auto;
    }
    .table-card h3 {
      margin-bottom: 16px;
      color: #c9d1d9;
      position: sticky;
      top: 0;
      background: #161b22;
      padding-bottom: 8px;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d; }
    th { color: #8b949e; font-weight: 500; font-size: 0.85rem; }
    td { font-size: 0.9rem; }
    tr:hover { background: #1f2428; }
    .user-cell { display: flex; align-items: center; gap: 10px; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .badge.starred { background: #f0c14b22; color: #f0c14b; }
    .badge.forked { background: #a371f722; color: #a371f7; }
    .badge.both { background: #3fb95022; color: #3fb950; }
    .location-bar { display: flex; align-items: center; margin-bottom: 8px; }
    .location-bar .name {
      width: 150px;
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .location-bar .bar {
      flex: 1;
      height: 20px;
      background: #30363d;
      border-radius: 4px;
      margin: 0 12px;
      overflow: hidden;
    }
    .location-bar .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #58a6ff, #a371f7);
      border-radius: 4px;
    }
    .location-bar .count { width: 30px; text-align: right; font-size: 0.85rem; color: #8b949e; }
    @media (max-width: 600px) {
      .charts-grid, .tables-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Maestro Community Dashboard</h1>
    <p id="generated-at"></p>
  </div>
  <div class="stats-grid">
    <div class="stat-card stars"><div class="value" id="total-stars">-</div><div class="label">Stars</div></div>
    <div class="stat-card forks"><div class="value" id="total-forks">-</div><div class="label">Forks</div></div>
    <div class="stat-card users"><div class="value" id="total-users">-</div><div class="label">Unique Members</div></div>
    <div class="stat-card reach"><div class="value" id="total-reach">-</div><div class="label">Community Reach</div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-card"><h3>Star Growth Over Time</h3><div class="chart-container"><canvas id="star-chart"></canvas></div></div>
    <div class="chart-card"><h3>Fork Growth Over Time</h3><div class="chart-container"><canvas id="fork-chart"></canvas></div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-card"><h3>Top Locations</h3><div id="locations-chart"></div></div>
    <div class="chart-card"><h3>Top Companies</h3><div id="companies-chart"></div></div>
  </div>
  <div class="tables-grid">
    <div class="table-card"><h3>Top Influencers</h3><table id="influencers-table"><thead><tr><th>User</th><th>Company</th><th>Followers</th></tr></thead><tbody></tbody></table></div>
    <div class="table-card"><h3>Recent Activity</h3><table id="activity-table"><thead><tr><th>User</th><th>Action</th><th>Date</th></tr></thead><tbody></tbody></table></div>
    <div class="table-card"><h3>Highly Engaged (Starred + Forked)</h3><table id="engaged-table"><thead><tr><th>User</th><th>Location</th><th>Followers</th></tr></thead><tbody></tbody></table></div>
    <div class="table-card"><h3>All Community Members</h3><table id="members-table"><thead><tr><th>User</th><th>Status</th><th>Joined GitHub</th></tr></thead><tbody></tbody></table></div>
  </div>
  <script>
    const DATA = ${JSON.stringify(embeddedData)};
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';

    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }
    function formatDate(dateStr) {
      if (!dateStr) return 'N/A';
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function escapeText(str) { return str ? String(str) : ''; }
    function createLink(href, text) {
      const a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = text;
      return a;
    }
    function createBadge(type) {
      const span = document.createElement('span');
      span.className = 'badge ' + type; span.textContent = type;
      return span;
    }
    function createGrowthChart(canvasId, data, color) {
      new Chart(document.getElementById(canvasId).getContext('2d'), {
        type: 'line',
        data: {
          labels: data.map(d => d.date),
          datasets: [{ label: 'Cumulative', data: data.map(d => d.cumulative), borderColor: color, backgroundColor: color + '22', fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, grid: { color: '#30363d' } } } }
      });
    }
    function createBarChart(containerId, data, maxItems = 10) {
      const container = document.getElementById(containerId);
      container.replaceChildren();
      const maxCount = Math.max(...data.slice(0, maxItems).map(d => d[1]));
      data.slice(0, maxItems).forEach(([name, count]) => {
        const row = document.createElement('div'); row.className = 'location-bar';
        const nameDiv = document.createElement('div'); nameDiv.className = 'name'; nameDiv.title = escapeText(name); nameDiv.textContent = escapeText(name);
        const barDiv = document.createElement('div'); barDiv.className = 'bar';
        const barFill = document.createElement('div'); barFill.className = 'bar-fill'; barFill.style.width = (count / maxCount * 100) + '%';
        barDiv.appendChild(barFill);
        const countDiv = document.createElement('div'); countDiv.className = 'count'; countDiv.textContent = count;
        row.appendChild(nameDiv); row.appendChild(barDiv); row.appendChild(countDiv);
        container.appendChild(row);
      });
    }
    function populateTable(tableId, rows, cellFn) {
      const tbody = document.querySelector('#' + tableId + ' tbody');
      tbody.replaceChildren();
      rows.forEach(row => {
        const tr = document.createElement('tr');
        cellFn(row).forEach(cell => tr.appendChild(cell));
        tbody.appendChild(tr);
      });
    }

    (function init() {
      const { report, stargazers, forkers, userDetails } = DATA;
      document.getElementById('generated-at').textContent = 'Last updated: ' + formatDate(report.generatedAt);
      document.getElementById('total-stars').textContent = report.summary.totalStars;
      document.getElementById('total-forks').textContent = report.summary.totalForks;
      document.getElementById('total-users').textContent = report.summary.uniqueUsers;
      document.getElementById('total-reach').textContent = formatNumber(report.demographics?.totalCommunityFollowers || 0);

      createGrowthChart('star-chart', report.starGrowth, '#f0c14b');
      createGrowthChart('fork-chart', report.forkGrowth, '#a371f7');

      if (report.demographics) {
        createBarChart('locations-chart', report.demographics.topLocations);
        createBarChart('companies-chart', report.demographics.topCompanies);
      }

      populateTable('influencers-table', report.topInfluencers || [], u => {
        const td1 = document.createElement('td'); td1.appendChild(createLink('https://github.com/' + u.username, '@' + u.username));
        const td2 = document.createElement('td'); td2.textContent = escapeText(u.company) || '-';
        const td3 = document.createElement('td'); td3.textContent = formatNumber(u.followers);
        return [td1, td2, td3];
      });

      const activity = [...stargazers.map(s => ({ ...s, action: 'starred', date: s.starredAt })), ...forkers.map(f => ({ ...f, action: 'forked', date: f.forkedAt }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
      populateTable('activity-table', activity, a => {
        const td1 = document.createElement('td'); td1.className = 'user-cell';
        const img = document.createElement('img'); img.className = 'avatar'; img.src = a.avatarUrl; img.alt = '';
        td1.appendChild(img); td1.appendChild(createLink(a.profileUrl, '@' + a.username));
        const td2 = document.createElement('td'); td2.appendChild(createBadge(a.action));
        const td3 = document.createElement('td'); td3.textContent = formatDate(a.date);
        return [td1, td2, td3];
      });

      populateTable('engaged-table', report.engagedUsers || [], username => {
        const details = userDetails[username] || {};
        const td1 = document.createElement('td'); td1.appendChild(createLink('https://github.com/' + username, '@' + username));
        const td2 = document.createElement('td'); td2.textContent = escapeText(details.location) || '-';
        const td3 = document.createElement('td'); td3.textContent = formatNumber(details.followers || 0);
        return [td1, td2, td3];
      });

      const starSet = new Set(stargazers.map(s => s.username));
      const forkSet = new Set(forkers.map(f => f.username));
      const allMembers = [...new Set([...starSet, ...forkSet])].sort();
      populateTable('members-table', allMembers, username => {
        const details = userDetails[username] || {};
        const starred = starSet.has(username), forked = forkSet.has(username);
        const td1 = document.createElement('td'); td1.appendChild(createLink('https://github.com/' + username, '@' + username));
        const td2 = document.createElement('td');
        if (starred && forked) td2.appendChild(createBadge('both'));
        else if (starred) td2.appendChild(createBadge('starred'));
        else if (forked) td2.appendChild(createBadge('forked'));
        const td3 = document.createElement('td'); td3.textContent = details.createdAt ? formatDate(details.createdAt) : '-';
        return [td1, td2, td3];
      });
    })();
  </script>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const fetchDetails = args.includes('--fetch-details');
  const jsonOutput = args.includes('--json');

  console.log(`\n=== GitHub Community Analytics for ${REPO} ===\n`);

  // Fetch basic data
  const stargazers = fetchStargazers();
  console.log(`  Found ${stargazers.length} stargazers`);

  const forkers = fetchForkers();
  console.log(`  Found ${forkers.length} forkers`);

  // Save raw data
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'stargazers.json'),
    JSON.stringify(stargazers, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'forkers.json'),
    JSON.stringify(forkers, null, 2)
  );

  // Create user list
  const uniqueUsers = [...new Set([
    ...stargazers.map(s => s.username),
    ...forkers.map(f => f.username),
  ])].sort();

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_users.txt'),
    uniqueUsers.join('\n')
  );

  // Optionally fetch user details
  let userDetails = null;
  if (fetchDetails) {
    console.log(`\nFetching details for ${uniqueUsers.length} users (this may take a while)...`);
    userDetails = {};
    for (let i = 0; i < uniqueUsers.length; i++) {
      const username = uniqueUsers[i];
      process.stdout.write(`  [${i + 1}/${uniqueUsers.length}] ${username}...`);
      userDetails[username] = fetchUserDetails(username);
      console.log(' done');

      // Rate limiting - GitHub allows 5000 requests/hour for authenticated users
      if (i > 0 && i % 50 === 0) {
        console.log('  Pausing for rate limiting...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'user_details.json'),
      JSON.stringify(userDetails, null, 2)
    );
  }

  // Generate report
  const report = generateReport(stargazers, forkers, userDetails);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'report.json'),
    JSON.stringify(report, null, 2)
  );

  const markdown = generateMarkdownReport(report);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'COMMUNITY_REPORT.md'),
    markdown
  );

  // Generate self-contained HTML dashboard
  const htmlDashboard = generateHtmlDashboard(report, stargazers, forkers, userDetails);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.html'),
    htmlDashboard
  );

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n' + markdown);
  }

  console.log(`\n=== Files Generated in ${OUTPUT_DIR}/ ===`);
  console.log('  stargazers.json      - Raw stargazer data');
  console.log('  forkers.json         - Raw forker data');
  console.log('  all_users.txt        - Unique usernames');
  console.log('  report.json          - Full analytics report');
  console.log('  COMMUNITY_REPORT.md  - Markdown report');
  if (userDetails) {
    console.log('  user_details.json    - Detailed user profiles');
  }

  console.log('\n=== Useful Commands ===');
  console.log('');
  console.log('# Re-run with user details (slower, more data):');
  console.log('  node scripts/github-community-analytics.js --fetch-details');
  console.log('');
  console.log('# Query a specific user:');
  console.log('  gh api users/USERNAME --jq \'{login, name, company, location, followers}\'');
  console.log('');
}

main().catch(console.error);
