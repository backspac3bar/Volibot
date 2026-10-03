import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { applicationId, emojiPlan, registerEmojis } from "../scripts/register-lol-emojis.mjs";

const smallPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64");
const plan = emojiPlan({ data: { Ahri: { key: "103", image: { full: "Ahri.png" } } } }, "16.19.1", []);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test("public plan validates numeric IDs, filenames and a bounded roster", () => {
  assert.equal(plan[0].name, "lol_champion_103");
  assert.equal(plan[0].url, "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Ahri.png");
  const complete = emojiPlan({ data: { Ahri: { key: "103", image: { full: "Ahri.png" } } } }, "16.19.1");
  assert.equal(complete.filter((row) => row.name.startsWith("lol_rank_")).length, 10);
  assert.ok(complete.some((row) => row.name === "lol_rank_emerald"));
  for (const champion of [{ key: "0", image: { full: "Ahri.png" } }, { key: "103", image: { full: "../../secret.png" } }]) {
    assert.throws(() => emojiPlan({ data: { Ahri: champion } }, "16.19.1"));
  }
});

test("a different bot token is rejected before any image download or mutations", async () => {
  const calls = [];
  await assert.rejects(registerEmojis({ token: "fake", plan, fetch: async (url) => {
    calls.push(url); return json({ id: "other-bot", bot: true });
  }, log: () => {} }), /does not belong to Volibot/);
  assert.equal(calls.length, 1);
});

test("registration is idempotent, preserves other emojis and never sends auth to the public CDN", async () => {
  const emojis = [{ name: "existing_unrelated", id: "111" }];
  const logs = [];
  let downloads = 0;
  let posts = 0;
  const fetch = async (url, options) => {
    if (url.startsWith("https://ddragon.leagueoflegends.com/")) {
      downloads++;
      assert.deepEqual(options.headers, {});
      return new Response(smallPng);
    }
    assert.equal(options.headers.Authorization, "Bot not-real-secret");
    assert.ok(["GET", "POST"].includes(options.method));
    if (url.endsWith("/users/@me")) return json({ id: applicationId, bot: true });
    if (options.method === "GET") return json({ items: emojis });
    posts++;
    const { name, image } = JSON.parse(options.body);
    assert.match(image, /^data:image\/png;base64,/);
    emojis.push({ name, id: "222" });
    return json({ name, id: "222" });
  };
  const first = await registerEmojis({ token: "not-real-secret", plan, fetch, sleep: async () => {}, log: (value) => logs.push(value) });
  assert.equal(first.created, 1);
  assert.deepEqual(first.missing, []);
  const second = await registerEmojis({ token: "not-real-secret", plan, fetch, sleep: async () => {}, log: (value) => logs.push(value) });
  assert.equal(second.reused, 1);
  assert.equal(posts, 1);
  assert.equal(downloads, 1);
  assert.equal(emojis[0].name, "existing_unrelated");
  assert.ok(!logs.join("\n").includes("not-real-secret"));
});

test("Discord rate-limit retries are bounded and do not duplicate a successful upload", async () => {
  let posts = 0;
  const delays = [];
  const emojis = [];
  const summary = await registerEmojis({ token: "fake", plan, log: () => {}, sleep: async (ms) => delays.push(ms),
    fetch: async (url, options) => {
      if (url.startsWith("https://ddragon.leagueoflegends.com/")) return new Response(smallPng);
      if (url.endsWith("/users/@me")) return json({ id: applicationId, bot: true });
      if (options.method === "GET") return json({ items: emojis });
      if (++posts === 1) return json({ retry_after: 1 }, 429);
      emojis.push({ name: plan[0].name, id: "222" });
      return json(emojis[0]);
    } });
  assert.equal(posts, 2);
  assert.equal(summary.created, 1);
  assert.deepEqual(delays, [1000, 250]);
});

test("missing credentials and oversized icons never create emojis", async () => {
  await assert.rejects(registerEmojis({ plan }), /not configured/);
  let posts = 0;
  const summary = await registerEmojis({ token: "fake", plan, log: () => {}, sleep: async () => {},
    fetch: async (url, options) => {
      if (url.startsWith("https://ddragon.leagueoflegends.com/")) return new Response(Buffer.alloc(256 * 1024 + 1));
      if (url.endsWith("/users/@me")) return json({ id: applicationId, bot: true });
      if (options.method === "POST") posts++;
      return json({ items: [] });
    } });
  assert.equal(posts, 0);
  assert.deepEqual(summary.missing, ["lol_champion_103"]);
});

test("bundled ranks are ten original small 80px emblems, not the 512px border assets", async () => {
  const tiers = emojiPlan({ data: { Ahri: { key: "103", image: { full: "Ahri.png" } } } }, "16.19.1")
    .filter((row) => row.name.startsWith("lol_rank_"));
  assert.equal(tiers.length, 10);
  for (const tier of tiers) {
    const buffer = await readFile(new URL(tier.url));
    assert.equal(buffer.readUInt32BE(16), 80);
    assert.equal(buffer.readUInt32BE(20), 80);
    assert.ok(buffer.length < 256 * 1024);
  }
});

test("replacement preserves champion IDs, backs up borders and is resumable without deleting emojis", async () => {
  const emojis = [{ name: "lol_champion_103", id: "111" }, { name: "lol_rank_platinum", id: "222" }];
  let creates = 0;
  const updates = [];
  const combined = [...plan, { name: "lol_rank_platinum", url: plan[0].url }];
  const fetch = async (url, options) => {
    if (url.startsWith("https://ddragon.leagueoflegends.com/")) return new Response(smallPng);
    if (url.endsWith("/users/@me")) return json({ id: applicationId, bot: true });
    if (options.method === "GET") return json({ items: emojis });
    assert.notEqual(options.method, "DELETE");
    const body = JSON.parse(options.body);
    if (options.method === "POST") {
      creates++;
      const emoji = { name: body.name, id: "333" };
      emojis.push(emoji);
      return json(emoji);
    }
    const emoji = emojis.find((emoji) => url.endsWith(`/${emoji.id}`));
    updates.push(body.name);
    emoji.name = body.name;
    return json(emoji);
  };
  const options = { token: "fake", plan: combined, replaceTiers: true, fetch, sleep: async () => {}, log: () => {} };
  const first = await registerEmojis(options);
  assert.equal(first.replaced, 1);
  assert.deepEqual(updates, ["lol_border_backup_platinum", "lol_rank_platinum"]);
  assert.equal(emojis.find((emoji) => emoji.name === "lol_champion_103").id, "111");
  assert.equal(emojis.find((emoji) => emoji.name === "lol_rank_platinum").id, "333");
  const second = await registerEmojis(options);
  assert.equal(second.reused, 2);
  assert.equal(creates, 1);
});

test("failed emblem creation leaves the existing border name untouched and reports failure", async () => {
  const tierPlan = [{ name: "lol_rank_platinum", url: plan[0].url }];
  const summary = await registerEmojis({ token: "fake", plan: tierPlan, replaceTiers: true, sleep: async () => {}, log: () => {},
    fetch: async (url, options) => {
      if (url.startsWith("https://ddragon.leagueoflegends.com/")) return new Response(smallPng);
      if (url.endsWith("/users/@me")) return json({ id: applicationId, bot: true });
      if (options.method === "GET") return json({ items: [{ name: "lol_rank_platinum", id: "222" }] });
      assert.equal(options.method, "POST");
      return json({}, 403);
    } });
  assert.deepEqual(summary.failed, ["lol_rank_platinum"]);
  assert.equal(summary.replaced, 0);
});
