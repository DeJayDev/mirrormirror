import { Client, Intents } from "discord.js";
import DiscordSelfbot, { Message } from "discord.js-selfbot-v13";
import { Cloner } from "./cloner";
import { config } from "./config";
import { WebhookManager } from "./webhook";

const selfBotClient = new DiscordSelfbot.Client({
  checkUpdate: false,
});
const botClient = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MEMBERS,
  ],
});

const cloners = new Map<string, Cloner>();
let webhookManager: WebhookManager;
let initialized = false;

selfBotClient.on("ready", async () => {
  while (!botClient.isReady()) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[SELF BOT] Starting ${config.guilds.length} cloner${config.guilds.length > 1 ? "s" : ""}...`
  );

  for (const guild of config.guilds) {
    const sourceGuild = await selfBotClient.guilds.fetch(guild.source);
    const targetGuild = await botClient.guilds.fetch(guild.target);

    webhookManager = new WebhookManager(`${sourceGuild.name} Mirror`);
    cloners.set(
      guild.source,
      new Cloner(
        sourceGuild,
        targetGuild,
        webhookManager,
        guild.skipBackfill ?? false
      )
    );
    const cloner = cloners.get(guild.source);

    console.log(`[SELF BOT] Purging legacy channels for ${sourceGuild.name}...`);
    await cloner?.purgeLegacy();
    await cloner?.sync();

    console.log(`[SELF BOT] Clone finished for ${sourceGuild.name}!`);
    console.log(`[SELF BOT] Starting listeners for ${sourceGuild.name}...`);

    // idk how not to "misuse promises" here ¯\_(ツ)_/¯
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setInterval(async () => await cloner?.sync(), 5 * 60 * 1000);
  }

  // After initalizing all guilds, set initialized to true
  initialized = true;
});

selfBotClient.on("messageCreate", async (message: Message) => {
  if (message.guildId == null || !cloners.has(message.guildId) || !initialized)
    return;
  const cloner = cloners.get(message.guildId);

  let title = "";
  if (message.content !== "") {
    title = message.content;
  } else if (message.embeds.length > 0) {
    title = message.embeds[0].title ?? "";
  }

  if (process.env.LOG_MESSAGES) { //eslint-disable-line
    console.log(
      `[${message.guild.name}] ${message.author.username}: ${title}`
    );
  }

  await cloner?.cloneMessage(message);
});

void selfBotClient.login(config.tokens.user).then(() => console.log("[SELF BOT] Logged in!"));
void botClient.login(config.tokens.bot).then(() => console.log("[BOT] Logged in!"));
