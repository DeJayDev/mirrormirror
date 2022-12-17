import DiscordSelfbot from "discord.js-selfbot-v13";
import { Client, Intents } from "discord.js";
import { config } from "./config";
import { Cloner } from "./cloner";
import { WebhookManager } from "./webhook";

const selfBotClient = new DiscordSelfbot.Client({
  checkUpdate: false
});
const botClient = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS]
});

let cloners = new Map<string, Cloner>();
let webhookManager: WebhookManager;
let initialized = false;

selfBotClient.on("ready", async () => {
  while (!botClient.isReady()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`[SELF BOT] Starting ${config.guilds.length} cloner${config.guilds.length > 1 ? 's' : ''}...`);

  for (const guild of config.guilds) {
    const sourceGuild = await selfBotClient.guilds.fetch(guild.source);
    const targetGuild = await botClient.guilds.fetch(guild.target);

    webhookManager = new WebhookManager(`${sourceGuild.name} Mirror`);
    cloners.set(guild.source, new Cloner(sourceGuild, targetGuild, webhookManager, guild.skipBackfill));
    let cloner = cloners.get(guild.source);

    console.log(`[SELF BOT] Purging legacy channels for ${sourceGuild.name}...`);
    await cloner.purgeLegacy();
    await cloner.sync();

    console.log(`[SELF BOT] Clone finished for ${sourceGuild.name}!`);
    console.log(`[SELF BOT] Starting listeners for ${sourceGuild.name}...`);

    setInterval(async () => await cloner.sync(), 5 * 60 * 1000);
  }

  // After initalizing all guilds, set initialized to true
  initialized = true;
});

selfBotClient.on("messageCreate", async message => {
  const cloner = cloners.get(message.guildId); 
  if (!message.guild || !cloner || !initialized) return;

  let title = '';
  if(message.content) {
    title = message.content;
  } else if(message.embeds.length > 0) {
    title = message.embeds[0].title;
  }

  //console.log(`[${message.guild.name}] ${message.author.username}: ${message.content ? message.content : message.embeds[0].title}`);
  await cloner.cloneMessage(message);
});

selfBotClient.login(config.tokens.user).then(() => console.log("[SELF BOT] Logged in!"));
botClient.login(config.tokens.bot).then(() => console.log("[BOT] Logged in!"));