const DiscordSelfbot = require("discord.js-selfbot-v13");
const Discord = require("discord.js");
const {config} = require("./config");
const {Cloner} = require("./cloner");
const {WebhookManager} = require("./webhook");

const selfBotClient = new DiscordSelfbot.Client({
  checkUpdate: false
});
const botClient = new Discord.Client({
  intents: ["GUILD_MESSAGES", "GUILD_MEMBERS", "GUILDS"]
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
  await cloner.purgeLegacy(targetGuild);
  await cloner.sync();

  console.log("[SELF BOT] Clone finished! Starting listeners...");
  initialized = true;
});

selfBotClient.on("messageCreate", async message => {
  console.log(`[${message.guild.name}] ${message.author.username}: ${message.content}`);
  if (message.guildId !== config.guilds.source || !initialized) return;
  await cloner.cloneMessage(message);
});

selfBotClient.login(config.tokens.user).then(() => console.log("[SELF BOT] Logged in!"));
botClient.login(config.tokens.bot).then(() => console.log("[BOT] Logged in!"));