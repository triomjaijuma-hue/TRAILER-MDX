'use strict';
// .update — owner-only command that pulls the latest commit and restarts the bot.
// Best path: trigger a Railway redeploy via Railway's GraphQL API (only true update on Railway).
// Fallback: exit the process so a container restart policy picks the latest image.

const axios = require('axios');

const owner = true;

async function railwayRedeploy() {
  const token = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !serviceId || !environmentId) {
    return {
      ok: false,
      reason: 'missing-token',
      message:
        '⚠️ Railway API token not set.\n\n' +
        'To enable one-tap updates from WhatsApp:\n' +
        '1. Open https://railway.com/account/tokens\n' +
        '2. Click *Create Token* → copy it\n' +
        '3. In your Railway project → *Variables* → add:\n' +
        '   `RAILWAY_API_TOKEN=<the token>`\n' +
        '4. Railway auto-injects `RAILWAY_SERVICE_ID` and `RAILWAY_ENVIRONMENT_ID`.\n\n' +
        'After that, `.update` will redeploy the bot to the latest commit on its own.',
    };
  }
  const r = await axios.post(
    'https://backboard.railway.com/graphql/v2',
    {
      query: `mutation Redeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      variables: { serviceId, environmentId },
    },
    {
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (r.data?.errors?.length) {
    return { ok: false, reason: 'api-error', message: r.data.errors.map((e) => e.message).join('; ') };
  }
  return { ok: true };
}

async function latestCommit() {
  try {
    const r = await axios.get(
      'https://api.github.com/repos/triomjaijuma-hue/TRAILER-MDX/commits/main',
      { timeout: 10000, headers: { 'User-Agent': 'TRAILER-MDX' } }
    );
    return {
      sha: r.data.sha?.slice(0, 7),
      message: r.data.commit?.message?.split('\n')[0],
      author: r.data.commit?.author?.name,
    };
  } catch (_) {
    return null;
  }
}

module.exports = [
  {
    name: 'update', aliases: ['upgrade', 'pull'], owner,
    description: 'Pull the latest version of the bot from GitHub and restart',
    handler: async ({ reply }) => {
      const latest = await latestCommit();
      const header = latest
        ? `🔄 *Updating to latest commit*\n\n*${latest.sha}* — ${latest.message}\n_by ${latest.author}_\n\n`
        : `🔄 *Updating bot...*\n\n`;

      try {
        const result = await railwayRedeploy();
        if (result.ok) {
          await reply(header + '✅ Redeploy triggered on Railway. Bot will be back online in ~30s with the new code.');
          // Give the message time to flush, then exit so the new build takes over cleanly.
          setTimeout(() => process.exit(0), 3000);
          return;
        }
        if (result.reason === 'missing-token') {
          return reply(header + result.message);
        }
        return reply(header + `❌ Update failed: ${result.message}\n\nFalling back to manual: open Railway → Deployments → Redeploy.`);
      } catch (e) {
        return reply(`❌ Update failed: ${e?.response?.data?.errors?.[0]?.message || e.message}`);
      }
    },
  },
  {
    name: 'version', aliases: ['ver', 'about'], owner: false,
    description: 'Show bot version and the latest GitHub commit',
    handler: async ({ reply }) => {
      const config = require('../../lib/config');
      const latest = await latestCommit();
      let txt = `🤖 *${config.botName}* v${config.version}\nNode ${process.version} • Uptime ${Math.round(process.uptime() / 60)}m`;
      if (latest) txt += `\n\n*Latest on GitHub:* ${latest.sha} — ${latest.message}`;
      reply(txt);
    },
  },
];
