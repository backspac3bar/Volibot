import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const applicationId = "1339273098234695800";
const discordBase = "https://discord.com/api/v10";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const tierIcons = [
  ["iron", "01_iron/01_iron_base"], ["bronze", "02_bronze/02_bronze_base"],
  ["silver", "03_silver/03_silver_base"], ["gold", "04_gold/04_gold_base"],
  ["platinum", "05_platinum/05_platinum_base_new"], ["emerald", "emerald/emerald_base"],
  ["diamond", "06_diamond/06_diamond_base"], ["master", "07_master/07_master_base"],
  ["grandmaster", "08_grandmaster/08_grandmaster_base"], ["challenger", "09_challenger/09_challenger_base"],
].map(([tier, file]) => ({ name: `lol_rank_${tier}`,
  url: `https://raw.communitydragon.org/latest/game/assets/loadouts/regalia/crests/ranked/${file}.png` }));

export function emojiPlan(champions, version, tiers = tierIcons) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !champions?.data || typeof champions.data !== "object") {
    throw new Error("Invalid public champion metadata");
  }
  const rows = Object.values(champions.data).map((champion) => {
    if (!/^[1-9]\d{0,5}$/.test(String(champion?.key)) || !/^[A-Za-z0-9_-]+\.png$/.test(champion.image?.full ?? "")) {
      throw new Error("Invalid champion icon metadata");
    }
    return { name: `lol_champion_${champion.key}`, url: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.image.full}` };
  });
  if (rows.length < 1 || rows.length > 250 || new Set(rows.map((row) => row.name)).size !== rows.length) {
    throw new Error("Invalid champion count or duplicate IDs");
  }
  return [...rows, ...tiers];
}

async function png(url, fetch) {
  const response = await fetch(url, { headers: {}, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) throw new Error(`Public icon HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error("Public icon exceeds Discord's 256 KiB limit");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("Public icon is not PNG");
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function registerEmojis({ token, plan, fetch = globalThis.fetch, sleep = delay, log = console.log }) {
  if (!token?.trim()) throw new Error("DISCORD_BOT_TOKEN is not configured in GitHub Secrets");
  async function discord(path, method = "GET", body) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response;
      try {
        response = await fetch(`${discordBase}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bot ${token.trim()}`, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch { throw new Error("Discord network request failed"); }
      if (response.status === 429) {
        const retry = await response.json();
        const ms = Math.ceil(Number(retry.retry_after) * 1000);
        if (!Number.isFinite(ms) || ms < 0 || ms > 30000) throw new Error("Discord cooldown is too long; safely rerun later");
        await sleep(Math.max(500, ms));
        continue;
      }
      if (!response.ok) throw new Error(`Discord ${method} HTTP ${response.status}`);
      return response.json();
    }
    throw new Error("Discord rate limit persisted; safely rerun later");
  }
  const bot = await discord("/users/@me");
  if (bot.id !== applicationId || bot.bot !== true) throw new Error("Token does not belong to Volibot; no emoji changes made");
  log(`Verified Volibot application ${applicationId}`);
  const current = await discord(`/applications/${applicationId}/emojis`);
  if (!Array.isArray(current.items)) throw new Error("Invalid Discord emoji list");
  const existing = new Set(current.items.map((emoji) => emoji.name));
  if (current.items.length + plan.filter((row) => !existing.has(row.name)).length > 2000) throw new Error("Application emoji slots would exceed 2000; no changes made");
  const summary = { expected: plan.length, created: 0, reused: 0, failed: [] };
  for (const row of plan) {
    if (existing.has(row.name)) { summary.reused++; continue; }
    try {
      const image = await png(row.url, fetch);
      const emoji = await discord(`/applications/${applicationId}/emojis`, "POST", { name: row.name, image });
      if (emoji.name !== row.name || !/^\d+$/.test(emoji.id)) throw new Error("Discord did not return the expected emoji");
      existing.add(row.name);
      summary.created++;
      log(`Created ${row.name}`);
      await sleep(250);
    } catch (error) {
      summary.failed.push(row.name);
      log(`Failed ${row.name}: ${error.message}`);
      if (/Discord/.test(error.message)) break;
    }
  }
  const verified = await discord(`/applications/${applicationId}/emojis`);
  if (!Array.isArray(verified.items)) throw new Error("Invalid verification list");
  const names = new Set(verified.items.map((emoji) => emoji.name));
  summary.missing = plan.filter((row) => !names.has(row.name)).map((row) => row.name);
  log(JSON.stringify(summary));
  return summary;
}

export async function main() {
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", { signal: AbortSignal.timeout(10000) }).then((response) => {
    if (!response.ok) throw new Error(`Version metadata HTTP ${response.status}`);
    return response.json();
  });
  if (!/^\d+\.\d+\.\d+$/.test(versions?.[0])) throw new Error("Invalid Data Dragon version");
  const champions = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/ko_KR/champion.json`, { signal: AbortSignal.timeout(10000) }).then((response) => {
    if (!response.ok) throw new Error(`Champion metadata HTTP ${response.status}`);
    return response.json();
  });
  const plan = emojiPlan(champions, versions[0]);
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify({ applicationId, champions: plan.length - tierIcons.length, tiers: tierIcons.length, total: plan.length })); return; }
  const summary = await registerEmojis({ token: process.env.DISCORD_BOT_TOKEN, plan });
  if (summary.missing.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
