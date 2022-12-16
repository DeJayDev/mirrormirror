import DiscordSelfbot from "discord.js-selfbot-v13";
import { Client, Intents } from "discord.js";
import { config } from "./config";
import { Cloner } from "./cloner";
import { WebhookManager } from "./webhook";

const selfBotClient = new DiscordSelfbot.Client({
  checkUpdate: false
});
const botClient = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS],
  http: {
    version: 11
  }
});

let cloner: Cloner;
let webhookManager: WebhookManager;
let initialized = false;

selfBotClient.on("ready", async () => {
  while (!botClient.isReady()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log("[SELF BOT] Starting clone...");

  const sourceGuild = await selfBotClient.guilds.fetch(config.guilds.source);
  const targetGuild = await botClient.guilds.fetch(config.guilds.target);

  webhookManager = new WebhookManager("Mirror");
  cloner = new Cloner(sourceGuild, targetGuild, webhookManager);

  console.log("[SELF BOT] Purging legacy channels...");
  await cloner.purgeLegacy();
  await cloner.sync();

  console.log("[SELF BOT] Clone finished! Starting listeners...");
  initialized = true;

  setInterval(async () => await cloner.sync(), 5 * 60 * 1000);
});

selfBotClient.on("messageCreate", async message => {
  if (!message.guild || message.guildId !== config.guilds.source || !initialized) return;

  let title = '';
  if(message.content) {
    title = message.content;
  } else if(message.embeds.length > 0) {
    title = message.embeds[0].title;
  }

  console.log(`[${message.guild.name}] ${message.author.username}: ${message.content ? message.content : message.embeds[0].title}`);
  await cloner.cloneMessage(message);
});

selfBotClient.login(config.tokens.user).then(() => console.log("[SELF BOT] Logged in!"));
botClient.login(config.tokens.bot).then(() => console.log("[BOT] Logged in!"));